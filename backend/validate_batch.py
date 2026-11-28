"""
Validação em lote do FollicleTrack (detecção de bulbos por origem/tracking de fios
+ segmentação de fios e couro cabeludo em grayscale, sem rede neural).

Uso:
    # 1) Coloque as imagens em teste_images/ e execute:
    python validate_batch.py

    # 2) Ou aponte diretamente para qualquer pasta de imagens:
    python validate_batch.py --input "C:/caminho/da/sua/pasta"

    # 3) Para medir a acurácia real contra contagem manual (gabarito),
    #    crie um arquivo ground_truth.csv na pasta com colunas:
    #        image,expected_bulbs,expected_strands
    #    (ou passe --ground-truth caminho/ground_truth.csv).
    #    Labels YOLO (.txt) na mesma pasta ou em ../labels/ também são detectados automaticamente.

Saídas geradas em backend/validation_logs/<data_hora>/:
    - validation_log.txt           Relatório legível com contagem por imagem e acurácia geral
    - validation_results.csv       Tabela para Excel/Sheets com todas as métricas por imagem
    - validation_results.json      Log estruturado completo com detecções e métricas
    - ground_truth_template.csv    Modelo pronto para preencher o gabarito manual (se não houver)
    - visuals/<imagem>_panel.png   Painel comparativo (Original | Bulbos+Fios | Máscara Fios | Couro)
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from app import BASE_DIR, BULB_DETECTION_METHOD
from hair_segmentation import (
    detect_bulbs_from_hair_origins,
    render_combined_overlay,
    render_hair_mask_visual,
    render_scalp_mask_visual,
    segment_hairs_grayscale,
)

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
DEFAULT_INPUT_DIR = BASE_DIR.parent / "teste_images"
DEFAULT_OUTPUT_ROOT = BASE_DIR / "validation_logs"


def _parse_optional_int(value: str | None) -> int | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    try:
        return int(round(float(cleaned.replace(",", "."))))
    except ValueError:
        return None


def _load_ground_truth_csv(csv_path: Path) -> dict[str, dict[str, int | None]]:
    gt: dict[str, dict[str, int | None]] = {}
    if not csv_path.exists():
        return gt

    with csv_path.open("r", encoding="utf-8-sig", newline="") as fh:
        sample = fh.read(2048)
        fh.seek(0)
        delimiter = ";" if sample.count(";") > sample.count(",") else ","
        reader = csv.DictReader(fh, delimiter=delimiter)
        for row in reader:
            norm = {k.strip().lower(): (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k}
            img_name = norm.get("image") or norm.get("imagem") or norm.get("filename") or norm.get("arquivo")
            if not img_name:
                continue
            bulbs = _parse_optional_int(
                norm.get("expected_bulbs") or norm.get("bulbos") or norm.get("bulbs") or norm.get("gt_bulbs")
            )
            strands = _parse_optional_int(
                norm.get("expected_strands") or norm.get("fios") or norm.get("strands") or norm.get("gt_strands")
            )
            gt[img_name] = {"expected_bulbs": bulbs, "expected_strands": strands}
            gt[Path(img_name).name] = {"expected_bulbs": bulbs, "expected_strands": strands}
    return gt


def _find_yolo_label_file(image_path: Path) -> Path | None:
    candidates = [
        image_path.with_suffix(".txt"),
        image_path.parent / "labels" / f"{image_path.stem}.txt",
    ]
    # Estrutura padrão YOLO: .../images/<split>/img.png -> .../labels/<split>/img.txt
    parts = list(image_path.parts)
    for idx in range(len(parts) - 1, -1, -1):
        if parts[idx].lower() == "images":
            alt_parts = parts[:idx] + ["labels"] + parts[idx + 1 :]
            candidates.append(Path(*alt_parts).with_suffix(".txt"))
            break

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _load_yolo_boxes(label_path: Path, width: int, height: int) -> list[list[float]]:
    boxes: list[list[float]] = []
    for line in label_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        try:
            cx, cy, bw, bh = [float(x) for x in parts[1:5]]
        except ValueError:
            continue
        x1 = (cx - bw / 2.0) * width
        y1 = (cy - bh / 2.0) * height
        x2 = (cx + bw / 2.0) * width
        y2 = (cy + bh / 2.0) * height
        boxes.append([x1, y1, x2, y2])
    return boxes


def _box_iou(a: list[float], b: list[float]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0.0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0.0 else 0.0


def _match_centers_to_gt(
    pred_detections: list[dict[str, Any]],
    gt_boxes: list[list[float]],
) -> tuple[int, int, int]:
    """Retorna (TP, FP, FN) por casamento guloso de centros ordenado por confiança."""
    sorted_preds = sorted(pred_detections, key=lambda d: float(d.get("confidence", 0.0)), reverse=True)
    gt_info = [
        ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0, max(16.0, 0.75 * max(b[2] - b[0], b[3] - b[1])))
        for b in gt_boxes
    ]
    matched_gt: set[int] = set()
    tp = 0
    fp = 0

    for pred in sorted_preds:
        if "center" in pred:
            px, py = float(pred["center"][0]), float(pred["center"][1])
        else:
            b = pred["bbox"]
            px, py = (float(b[0]) + float(b[2])) / 2.0, (float(b[1]) + float(b[3])) / 2.0
        best_dist = 1e9
        best_idx = -1
        for idx, (gx, gy, gr) in enumerate(gt_info):
            if idx in matched_gt:
                continue
            d = float(math.hypot(px - gx, py - gy))
            if d <= gr and d < best_dist:
                best_dist = d
                best_idx = idx
        if best_idx >= 0:
            matched_gt.add(best_idx)
            tp += 1
        else:
            fp += 1

    fn = len(gt_boxes) - len(matched_gt)
    return tp, fp, fn


def _count_accuracy_pct(predicted: int, expected: int) -> float:
    if expected == 0:
        return 100.0 if predicted == 0 else 0.0
    return round(max(0.0, 1.0 - abs(predicted - expected) / expected) * 100.0, 2)


def _build_visual_panel(
    original_bgr: np.ndarray,
    combined_rgb: np.ndarray,
    hair_mask_rgb: np.ndarray,
    scalp_mask_rgb: np.ndarray,
    header_text: str,
) -> np.ndarray:
    """Monta painel comparativo 2x2 em BGR pronto para salvar via cv2.imwrite."""
    h, w = original_bgr.shape[:2]
    target_w = min(480, w)
    target_h = int(round(h * (target_w / w)))

    def prep(img_rgb: np.ndarray, title: str) -> np.ndarray:
        resized = cv2.resize(img_rgb, (target_w, target_h), interpolation=cv2.INTER_AREA)
        bar = np.full((28, target_w, 3), (15, 23, 42), dtype=np.uint8)
        cv2.putText(bar, title, (10, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (241, 245, 249), 1, cv2.LINE_AA)
        return np.vstack([bar, resized])

    orig_rgb = cv2.cvtColor(original_bgr, cv2.COLOR_BGR2RGB)
    top = np.hstack([prep(orig_rgb, "Original"), prep(combined_rgb, "Bulbos (Origem/Tracking) + Fios")])
    bottom = np.hstack([prep(hair_mask_rgb, "Mascara de Fios (Grayscale)"), prep(scalp_mask_rgb, "Mascara Couro Cabeludo")])
    grid = np.vstack([top, bottom])

    banner = np.full((38, grid.shape[1], 3), (20, 83, 45), dtype=np.uint8)
    font_scale = 0.56
    max_text_w = grid.shape[1] - 28
    while font_scale > 0.34:
        (tw, _), _ = cv2.getTextSize(header_text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)
        if tw <= max_text_w:
            break
        font_scale -= 0.03
    cv2.putText(banner, header_text, (14, 25), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), 1, cv2.LINE_AA)
    full_rgb = np.vstack([banner, grid])
    return cv2.cvtColor(full_rgb, cv2.COLOR_RGB2BGR)


def run_validation(
    input_dir: Path,
    output_dir: Path,
    ground_truth_csv: Path | None = None,
    conf: float = 0.72,
    hair_gray_max: int | None = None,
    save_visuals: bool = True,
) -> dict[str, Any]:
    if not input_dir.exists() or not input_dir.is_dir():
        raise SystemExit(f"Pasta de imagens não encontrada: {input_dir}")

    images = sorted(
        p for p in input_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )
    if not images:
        raise SystemExit(f"Nenhuma imagem encontrada em: {input_dir}")

    gt_csv_path = ground_truth_csv or (input_dir / "ground_truth.csv")
    gt_map = _load_ground_truth_csv(gt_csv_path)

    output_dir.mkdir(parents=True, exist_ok=True)
    visuals_dir = output_dir / "visuals"
    if save_visuals:
        visuals_dir.mkdir(parents=True, exist_ok=True)

    model_name = BULB_DETECTION_METHOD

    records: list[dict[str, Any]] = []
    total_tp = total_fp = total_fn = 0
    bulb_abs_errors: list[int] = []
    bulb_sq_errors: list[int] = []
    bulb_acc_list: list[float] = []
    strand_abs_errors: list[int] = []
    strand_sq_errors: list[int] = []
    strand_acc_list: list[float] = []
    all_confs: list[float] = []

    for img_path in images:
        rel_name = str(img_path.relative_to(input_dir)).replace("\\", "/")
        t0 = time.perf_counter()

        img_bgr = cv2.imread(str(img_path))
        if img_bgr is None:
            continue
        h, w = img_bgr.shape[:2]

        # 1. Segmentação de fios e couro cabeludo (grayscale + bitwise_not)
        seg = segment_hairs_grayscale(img_bgr, hair_gray_max=hair_gray_max)

        # 2. Detecção de bulbos via costura de fios + tracking até o couro cabeludo aberto
        detections, origin_debug = detect_bulbs_from_hair_origins(
            img_bgr,
            hair_mask=seg.hair_mask,
            scalp_mask=seg.scalp_mask,
            scalp_gray_median=seg.scalp_gray_median,
            min_confidence=conf,
            return_debug=True,
        )
        bulb_count = len(detections)
        confs = [float(d["confidence"]) for d in detections]
        all_confs.extend(confs)
        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)

        # 3. Ground truth (CSV e/ou labels .txt)
        gt_entry = gt_map.get(rel_name) or gt_map.get(img_path.name) or {}
        expected_bulbs = gt_entry.get("expected_bulbs")
        expected_strands = gt_entry.get("expected_strands")

        yolo_label_file = _find_yolo_label_file(img_path)
        tp = fp = fn = None
        precision = recall = f1 = None
        if yolo_label_file is not None:
            gt_boxes = _load_yolo_boxes(yolo_label_file, w, h)
            if expected_bulbs is None:
                expected_bulbs = len(gt_boxes)
            tp, fp, fn = _match_centers_to_gt(detections, gt_boxes)
            total_tp += tp
            total_fp += fp
            total_fn += fn
            precision = round(tp / (tp + fp) * 100.0, 2) if (tp + fp) > 0 else (100.0 if fn == 0 else 0.0)
            recall = round(tp / (tp + fn) * 100.0, 2) if (tp + fn) > 0 else 100.0
            f1 = round(2 * precision * recall / (precision + recall), 2) if (precision + recall) > 0 else 0.0

        bulb_acc = None
        if expected_bulbs is not None:
            err = abs(bulb_count - expected_bulbs)
            bulb_abs_errors.append(err)
            bulb_sq_errors.append(err * err)
            bulb_acc = _count_accuracy_pct(bulb_count, expected_bulbs)
            bulb_acc_list.append(bulb_acc)

        strand_acc = None
        if expected_strands is not None:
            err = abs(seg.strand_count - expected_strands)
            strand_abs_errors.append(err)
            strand_sq_errors.append(err * err)
            strand_acc = _count_accuracy_pct(seg.strand_count, expected_strands)
            strand_acc_list.append(strand_acc)

        visual_file = None
        if save_visuals:
            combined_rgb = render_combined_overlay(
                img_bgr,
                seg.hair_mask,
                detections,
                open_scalp=origin_debug["open_scalp"],
            )
            hair_mask_rgb = render_hair_mask_visual(seg.hair_mask)
            scalp_mask_rgb = render_scalp_mask_visual(img_bgr, seg.scalp_mask)
            header = (
                f"{img_path.name} | Bulbos: {bulb_count} | Fios: {seg.strand_count} | "
                f"Espessura: {seg.avg_thickness_px:.2f}px | Cobertura: {seg.hair_coverage_pct:.1f}%"
            )
            panel = _build_visual_panel(img_bgr, combined_rgb, hair_mask_rgb, scalp_mask_rgb, header)
            safe_stem = rel_name.replace("/", "__").rsplit(".", 1)[0]
            visual_path = visuals_dir / f"{safe_stem}_panel.png"
            cv2.imwrite(str(visual_path), panel)
            visual_file = str(visual_path.relative_to(output_dir)).replace("\\", "/")

        records.append(
            {
                "image": rel_name,
                "resolution": f"{w}x{h}",
                "bulb_count": bulb_count,
                "expected_bulbs": expected_bulbs,
                "bulb_accuracy_pct": bulb_acc,
                "yolo_avg_conf_pct": round((sum(confs) / len(confs)) * 100.0, 2) if confs else None,
                "yolo_min_conf_pct": round(min(confs) * 100.0, 2) if confs else None,
                "yolo_max_conf_pct": round(max(confs) * 100.0, 2) if confs else None,
                "bbox_tp": tp,
                "bbox_fp": fp,
                "bbox_fn": fn,
                "bbox_precision_pct": precision,
                "bbox_recall_pct": recall,
                "bbox_f1_pct": f1,
                "strand_count": seg.strand_count,
                "expected_strands": expected_strands,
                "strand_accuracy_pct": strand_acc,
                "avg_thickness_px": seg.avg_thickness_px,
                "median_thickness_px": seg.median_thickness_px,
                "hair_coverage_pct": seg.hair_coverage_pct,
                "gray_threshold": seg.gray_threshold,
                "scalp_gray_median": seg.scalp_gray_median,
                "hair_gray_median": seg.hair_gray_median,
                "inference_ms": elapsed_ms,
                "visual_panel": visual_file,
                "detections": detections,
            }
        )

    # Resumo consolidado
    n = len(records)
    total_bulbs = sum(r["bulb_count"] for r in records)
    total_strands = sum(r["strand_count"] for r in records)
    avg_bulbs = round(total_bulbs / n, 2) if n else 0.0
    avg_strands = round(total_strands / n, 2) if n else 0.0
    avg_thickness = round(sum(r["avg_thickness_px"] for r in records) / n, 2) if n else 0.0
    avg_coverage = round(sum(r["hair_coverage_pct"] for r in records) / n, 1) if n else 0.0
    avg_yolo_conf = round((sum(all_confs) / len(all_confs)) * 100.0, 2) if all_confs else None
    avg_ms = round(sum(r["inference_ms"] for r in records) / n, 1) if n else 0.0

    has_bbox_gt = (total_tp + total_fp + total_fn) > 0
    overall_precision = (
        round(total_tp / (total_tp + total_fp) * 100.0, 2) if (total_tp + total_fp) > 0 else None
    )
    overall_recall = (
        round(total_tp / (total_tp + total_fn) * 100.0, 2) if (total_tp + total_fn) > 0 else None
    )
    overall_f1 = (
        round(2 * overall_precision * overall_recall / (overall_precision + overall_recall), 2)
        if overall_precision is not None and overall_recall is not None and (overall_precision + overall_recall) > 0
        else None
    )

    summary = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "input_dir": str(input_dir),
        "output_dir": str(output_dir),
        "model_used": model_name,
        "origin_conf_threshold": conf,
        "hair_gray_max_override": hair_gray_max,
        "images_evaluated": n,
        "total_bulbs_detected": total_bulbs,
        "avg_bulbs_per_image": avg_bulbs,
        "total_strands_detected": total_strands,
        "avg_strands_per_image": avg_strands,
        "avg_thickness_px": avg_thickness,
        "avg_coverage_pct": avg_coverage,
        "yolo_mean_confidence_pct": avg_yolo_conf,
        "avg_inference_ms": avg_ms,
        "bulbs_accuracy": {
            "evaluated_images": len(bulb_acc_list),
            "count_accuracy_pct": round(sum(bulb_acc_list) / len(bulb_acc_list), 2) if bulb_acc_list else None,
            "mae": round(sum(bulb_abs_errors) / len(bulb_abs_errors), 2) if bulb_abs_errors else None,
            "rmse": round(math.sqrt(sum(bulb_sq_errors) / len(bulb_sq_errors)), 2) if bulb_sq_errors else None,
            "bbox_tp": total_tp if has_bbox_gt else None,
            "bbox_fp": total_fp if has_bbox_gt else None,
            "bbox_fn": total_fn if has_bbox_gt else None,
            "bbox_precision_pct": overall_precision,
            "bbox_recall_pct": overall_recall,
            "bbox_f1_pct": overall_f1,
        },
        "strands_accuracy": {
            "evaluated_images": len(strand_acc_list),
            "count_accuracy_pct": round(sum(strand_acc_list) / len(strand_acc_list), 2) if strand_acc_list else None,
            "mae": round(sum(strand_abs_errors) / len(strand_abs_errors), 2) if strand_abs_errors else None,
            "rmse": round(math.sqrt(sum(strand_sq_errors) / len(strand_sq_errors)), 2) if strand_sq_errors else None,
        },
    }

    # 1) Salvar JSON completo
    json_path = output_dir / "validation_results.json"
    json_path.write_text(
        json.dumps({"summary": summary, "images": records}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    # 2) Salvar CSV para planilha
    csv_fields = [
        "image",
        "resolution",
        "bulb_count",
        "expected_bulbs",
        "bulb_accuracy_pct",
        "yolo_avg_conf_pct",
        "bbox_precision_pct",
        "bbox_recall_pct",
        "bbox_f1_pct",
        "strand_count",
        "expected_strands",
        "strand_accuracy_pct",
        "avg_thickness_px",
        "median_thickness_px",
        "hair_coverage_pct",
        "gray_threshold",
        "inference_ms",
        "visual_panel",
    ]
    csv_path = output_dir / "validation_results.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=csv_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)

    # 3) Gerar modelo de gabarito caso não exista ground_truth.csv
    if not gt_csv_path.exists():
        tpl_path = output_dir / "ground_truth_template.csv"
        with tpl_path.open("w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["image", "expected_bulbs", "expected_strands"])
            for r in records:
                writer.writerow([r["image"], "", ""])

    # 4) Gerar LOG legível em texto
    lines: list[str] = []
    lines.append("=" * 98)
    lines.append("FOLLICLETRACK — LOG DE VALIDAÇÃO EM LOTE (ORIGEM/TRACKING DE FIOS + SEGMENTAÇÃO GRAYSCALE)")
    lines.append("=" * 98)
    lines.append(f"Data/Hora        : {summary['timestamp']}")
    lines.append(f"Pasta avaliada   : {summary['input_dir']}")
    lines.append(f"Método detecção  : {summary['model_used']} (conf={conf})")
    lines.append(f"Total de imagens : {n}")
    lines.append(f"Tempo médio/img  : {avg_ms} ms")
    lines.append("")
    lines.append("-" * 98)
    lines.append("RESULTADOS POR IMAGEM")
    lines.append("-" * 98)
    header_row = (
        f"{'Imagem':<36} {'Bulbos':>6} {'Conf%':>7} {'Fios':>6} {'Esp(px)':>8} {'Cob%':>6} "
        f"{'AccBulbo':>9} {'AccFio':>8}"
    )
    lines.append(header_row)
    lines.append("-" * 98)
    for r in records:
        name_disp = r["image"] if len(r["image"]) <= 35 else "..." + r["image"][-32:]
        conf_str = f"{r['yolo_avg_conf_pct']:.1f}%" if r["yolo_avg_conf_pct"] is not None else "—"
        b_acc_str = f"{r['bulb_accuracy_pct']:.1f}%" if r["bulb_accuracy_pct"] is not None else "—"
        s_acc_str = f"{r['strand_accuracy_pct']:.1f}%" if r["strand_accuracy_pct"] is not None else "—"
        lines.append(
            f"{name_disp:<36} {r['bulb_count']:>6} {conf_str:>7} {r['strand_count']:>6} "
            f"{r['avg_thickness_px']:>8.2f} {r['hair_coverage_pct']:>5.1f}% {b_acc_str:>9} {s_acc_str:>8}"
        )

    lines.append("")
    lines.append("-" * 98)
    lines.append("RESUMO E ACURÁCIA DO MODELO")
    lines.append("-" * 98)
    lines.append(f"Bulbos detectados (total / média)   : {total_bulbs} / {avg_bulbs} por imagem")
    lines.append(f"Fios detectados   (total / média)   : {total_strands} / {avg_strands} por imagem")
    lines.append(f"Espessura média dos fios            : {avg_thickness:.2f} px")
    lines.append(f"Cobertura capilar média             : {avg_coverage:.1f}%")
    lines.append(
        f"Confiança média das detecções       : "
        f"{f'{avg_yolo_conf:.2f}%' if avg_yolo_conf is not None else 'Nenhuma detecção acima do limiar'}"
    )

    ba = summary["bulbs_accuracy"]
    sa = summary["strands_accuracy"]
    if ba["evaluated_images"] > 0:
        lines.append("")
        lines.append(f"Acurácia de Contagem — Bulbos       : {ba['count_accuracy_pct']:.2f}% (MAE={ba['mae']}, RMSE={ba['rmse']}, n={ba['evaluated_images']})")
        if has_bbox_gt:
            lines.append(
                f"Métricas BBox YOLO (IoU >= 0.50)    : Precision={ba['bbox_precision_pct']:.2f}% | "
                f"Recall={ba['bbox_recall_pct']:.2f}% | F1={ba['bbox_f1_pct']:.2f}% "
                f"(TP={ba['bbox_tp']}, FP={ba['bbox_fp']}, FN={ba['bbox_fn']})"
            )
    else:
        lines.append("")
        lines.append("Acurácia real — Bulbos              : Sem gabarito (adicione ground_truth.csv ou labels YOLO .txt)")

    if sa["evaluated_images"] > 0:
        lines.append(f"Acurácia de Contagem — Fios         : {sa['count_accuracy_pct']:.2f}% (MAE={sa['mae']}, RMSE={sa['rmse']}, n={sa['evaluated_images']})")
    else:
        lines.append("Acurácia real — Fios                : Sem gabarito (preencha expected_strands em ground_truth.csv)")

    lines.append("=" * 98)
    report_text = "\n".join(lines)

    log_path = output_dir / "validation_log.txt"
    log_path.write_text(report_text + "\n", encoding="utf-8")

    print(report_text)
    print(f"\nLogs salvos em: {output_dir}")
    print(f"  - Log texto : {log_path}")
    print(f"  - Planilha  : {csv_path}")
    print(f"  - JSON      : {json_path}")
    if save_visuals:
        print(f"  - Painéis   : {visuals_dir}")
    if not gt_csv_path.exists():
        print(f"  - Gabarito  : {output_dir / 'ground_truth_template.csv'} (preencha e renomeie para ground_truth.csv na pasta de imagens)")

    return {"summary": summary, "images": records}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validação em lote de imagens tricoscópicas com log de acurácia e contagens.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT_DIR, help="Pasta com as imagens de teste.")
    parser.add_argument("--output", type=Path, default=None, help="Pasta de saída dos logs (padrão: validation_logs/<timestamp>).")
    parser.add_argument("--ground-truth", type=Path, default=None, help="CSV opcional com colunas image,expected_bulbs,expected_strands.")
    parser.add_argument("--conf", type=float, default=float(os.getenv("BULB_ORIGIN_CONFIDENCE", "0.72")), help="Confiança mínima do detector por origem/tracking de fios.")
    parser.add_argument("--hair-gray-max", type=int, default=None, help="Override opcional da janela grayscale dos fios (0..255).")
    parser.add_argument("--no-visuals", action="store_true", help="Não gera imagens de painel comparativo.")
    args = parser.parse_args()

    out_dir = args.output or (DEFAULT_OUTPUT_ROOT / datetime.now().strftime("%Y%m%d_%H%M%S"))
    run_validation(
        input_dir=args.input.resolve(),
        output_dir=out_dir.resolve(),
        ground_truth_csv=args.ground_truth.resolve() if args.ground_truth else None,
        conf=args.conf,
        hair_gray_max=args.hair_gray_max,
        save_visuals=not args.no_visuals,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
