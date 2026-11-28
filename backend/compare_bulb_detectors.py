"""
Comparativo lado a lado de detecção e contagem de bulbos:
  1) Modelo de detecção YOLO (best.pt)
  2) Origem dos fios a partir da segmentação em escala de cinza (detect_bulbs_from_hair_origins)

Avalia automaticamente:
  - Conjunto de validação rotulado com Ground Truth (imagens originais não-aumentadas)
  - Conjunto de teste real inédito (teste_images)

Gera painéis visuais em alta resolução para TODAS as imagens, tabelas CSV, JSON
e relatório completo em texto em backend/validation_logs/comparativo_bulbos_yolo_vs_origem/.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from app import BASE_DIR
from hair_segmentation import (
    detect_bulbs_from_hair_origins,
    render_origin_bulbs_overlay,
    segment_hairs_grayscale,
)


def _load_yolo_model(model_path: Path | None = None) -> Any:
    """Carrega o modelo YOLO sob demanda apenas para este script comparativo histórico."""
    from ultralytics import YOLO

    chosen = model_path or (BASE_DIR / "YOLO_MODEL" / "best.pt")
    print(f"Carregando modelo YOLO (referência comparativa): {chosen}")
    return YOLO(str(chosen))


def _parse_yolo_imgsz(raw: str | int | tuple[int, int] | list[int]) -> int | tuple[int, int]:
    if isinstance(raw, int):
        return raw
    if isinstance(raw, (tuple, list)) and len(raw) == 2:
        return (int(raw[0]), int(raw[1]))
    text = str(raw).strip().lower()
    for sep in ("x", ",", " "):
        if sep in text:
            parts = [p.strip() for p in text.split(sep) if p.strip()]
            if len(parts) == 2:
                return (int(parts[1]), int(parts[0]))
    return int(text)


def _build_yolo_detections(result: Any) -> list[dict[str, Any]]:
    if result.boxes is None or len(result.boxes) == 0:
        return []
    labels = getattr(result, "names", {}) or {}
    detections: list[dict[str, Any]] = []
    for box in result.boxes:
        x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
        cls_id = int(box.cls[0].item())
        conf = float(box.conf[0].item())
        detections.append({"class": labels.get(cls_id, str(cls_id)), "confidence": round(conf, 4), "bbox": [x1, y1, x2, y2]})
    return detections

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
DEFAULT_VAL_DIR = Path(r"c:\Users\arthu\OneDrive\Documents\hair_follicle\follicle_frames_pronto\images\val")
DEFAULT_VAL_LABELS = Path(r"c:\Users\arthu\OneDrive\Documents\hair_follicle\follicle_frames_pronto\labels\val")
DEFAULT_TEST_DIR = BASE_DIR.parent / "teste_images"
DEFAULT_OUTPUT_DIR = BASE_DIR / "validation_logs" / "comparativo_bulbos_yolo_vs_origem"


def _det_center(det: dict[str, Any]) -> tuple[float, float]:
    if "center" in det:
        return float(det["center"][0]), float(det["center"][1])
    x1, y1, x2, y2 = det["bbox"]
    return (float(x1) + float(x2)) / 2.0, (float(y1) + float(y2)) / 2.0


def _load_yolo_gt(label_path: Path, w: int, h: int) -> list[list[float]]:
    boxes: list[list[float]] = []
    if not label_path.exists():
        return boxes
    for line in label_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        cx, cy, bw, bh = [float(v) for v in parts[1:5]]
        boxes.append([(cx - bw / 2.0) * w, (cy - bh / 2.0) * h, (cx + bw / 2.0) * w, (cy + bh / 2.0) * h])
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


def _match_center_to_gt(
    preds: list[dict[str, Any]],
    gt_boxes: list[list[float]],
) -> dict[str, Any]:
    """Casamento 1-para-1 por distância do centro (raio adaptativo ao tamanho do GT)."""
    sorted_idx = sorted(range(len(preds)), key=lambda i: float(preds[i].get("confidence", 0.0)), reverse=True)
    gt_info = [
        ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0, max(16.0, 0.75 * max(b[2] - b[0], b[3] - b[1])))
        for b in gt_boxes
    ]
    matched_gt: set[int] = set()
    tp_preds: set[int] = set()
    fp_preds: set[int] = set()

    for pi in sorted_idx:
        px, py = _det_center(preds[pi])
        best_d = 1e9
        best_gi = -1
        for gi, (gx, gy, gr) in enumerate(gt_info):
            if gi in matched_gt:
                continue
            d = float(math.hypot(px - gx, py - gy))
            if d <= gr and d < best_d:
                best_d = d
                best_gi = gi
        if best_gi >= 0:
            matched_gt.add(best_gi)
            tp_preds.add(pi)
        else:
            fp_preds.add(pi)

    fn_gt = [gi for gi in range(len(gt_boxes)) if gi not in matched_gt]
    return {
        "tp": len(tp_preds),
        "fp": len(fp_preds),
        "fn": len(fn_gt),
        "tp_preds": tp_preds,
        "fp_preds": fp_preds,
        "matched_gt": matched_gt,
        "fn_gt": fn_gt,
    }


def _match_iou_to_gt(preds: list[dict[str, Any]], gt_boxes: list[list[float]], thr: float) -> tuple[int, int, int]:
    sorted_preds = sorted(preds, key=lambda d: float(d.get("confidence", 0.0)), reverse=True)
    matched: set[int] = set()
    tp = fp = 0
    for pred in sorted_preds:
        best_iou = 0.0
        best_gi = -1
        for gi, gt in enumerate(gt_boxes):
            if gi in matched:
                continue
            val = _box_iou(pred["bbox"], gt)
            if val > best_iou:
                best_iou = val
                best_gi = gi
        if best_iou >= thr and best_gi >= 0:
            matched.add(best_gi)
            tp += 1
        else:
            fp += 1
    return tp, fp, len(gt_boxes) - len(matched)


def _match_detectors(
    yolo_dets: list[dict[str, Any]],
    origin_dets: list[dict[str, Any]],
    max_dist_px: float = 20.0,
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Casa detecções do YOLO com detecções da Origem dos Fios (1-para-1 guloso por menor distância)."""
    pairs: list[tuple[float, int, int]] = []
    for yi, yd in enumerate(yolo_dets):
        yx, yy = _det_center(yd)
        for oi, od in enumerate(origin_dets):
            ox, oy = _det_center(od)
            d = float(math.hypot(yx - ox, yy - oy))
            if d <= max_dist_px:
                pairs.append((d, yi, oi))
    pairs.sort(key=lambda item: item[0])

    used_y: set[int] = set()
    used_o: set[int] = set()
    matched: list[tuple[int, int]] = []
    for _, yi, oi in pairs:
        if yi in used_y or oi in used_o:
            continue
        used_y.add(yi)
        used_o.add(oi)
        matched.append((yi, oi))

    only_y = [i for i in range(len(yolo_dets)) if i not in used_y]
    only_o = [i for i in range(len(origin_dets)) if i not in used_o]
    return matched, only_y, only_o


def _count_accuracy_pct(predicted: int, expected: int) -> float:
    if expected == 0:
        return 100.0 if predicted == 0 else 0.0
    return round(max(0.0, 1.0 - abs(predicted - expected) / expected) * 100.0, 2)


def _prf(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    p = (100.0 * tp / (tp + fp)) if (tp + fp) > 0 else (100.0 if fn == 0 else 0.0)
    r = (100.0 * tp / (tp + fn)) if (tp + fn) > 0 else 100.0
    f1 = (2.0 * p * r / (p + r)) if (p + r) > 0 else 0.0
    return round(p, 2), round(r, 2), round(f1, 2)


def _draw_yolo_clean_rgb(image_bgr: np.ndarray, detections: list[dict[str, Any]]) -> np.ndarray:
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB).copy()
    for det in detections:
        x1, y1, x2, y2 = [int(round(v)) for v in det["bbox"]]
        conf_pct = int(round(float(det.get("confidence", 0.0)) * 100))
        cv2.rectangle(rgb, (x1, y1), (x2, y2), (244, 63, 94), 2)
        cv2.putText(
            rgb,
            f"{conf_pct}%",
            (x1, max(12, y1 - 3)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.38,
            (255, 228, 230),
            1,
            cv2.LINE_AA,
        )
    return rgb


def _draw_gt_eval_rgb(
    image_bgr: np.ndarray,
    preds: list[dict[str, Any]],
    gt_boxes: list[list[float]],
    match_info: dict[str, Any],
    mode: str,
) -> np.ndarray:
    """Verde = TP (acerto), Vermelho = FP (falso positivo), Azul = FN (bulbo real perdido)."""
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB).copy()
    # FN (bulbos perdidos) em azul claro
    for gi in match_info["fn_gt"]:
        x1, y1, x2, y2 = [int(round(v)) for v in gt_boxes[gi]]
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        cv2.rectangle(rgb, (x1, y1), (x2, y2), (56, 189, 248), 2)
        cv2.drawMarker(rgb, (cx, cy), (56, 189, 248), cv2.MARKER_TILTED_CROSS, 10, 2, cv2.LINE_AA)

    for pi, det in enumerate(preds):
        is_tp = pi in match_info["tp_preds"]
        color = (34, 197, 94) if is_tp else (239, 68, 68)
        if mode == "yolo":
            x1, y1, x2, y2 = [int(round(v)) for v in det["bbox"]]
            cv2.rectangle(rgb, (x1, y1), (x2, y2), color, 2)
        else:
            cx, cy = [int(round(v)) for v in _det_center(det)]
            cv2.circle(rgb, (cx, cy), 9, color, 2, cv2.LINE_AA)
            cv2.circle(rgb, (cx, cy), 2, color, -1, cv2.LINE_AA)
    return rgb


def _draw_agreement_rgb(
    image_bgr: np.ndarray,
    yolo_dets: list[dict[str, Any]],
    origin_dets: list[dict[str, Any]],
    matched: list[tuple[int, int]],
    only_y: list[int],
    only_o: list[int],
) -> np.ndarray:
    """
    Verde   = Ambos detectaram (YOLO + Origem)
    Rosa    = Apenas YOLO detectou
    Amarelo = Apenas Origem dos Fios detectou
    """
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB).copy()
    for yi, oi in matched:
        x1, y1, x2, y2 = [int(round(v)) for v in yolo_dets[yi]["bbox"]]
        ox, oy = [int(round(v)) for v in _det_center(origin_dets[oi])]
        cv2.rectangle(rgb, (x1, y1), (x2, y2), (34, 197, 94), 2)
        cv2.circle(rgb, (ox, oy), 5, (34, 197, 94), -1, cv2.LINE_AA)
    for yi in only_y:
        x1, y1, x2, y2 = [int(round(v)) for v in yolo_dets[yi]["bbox"]]
        cv2.rectangle(rgb, (x1, y1), (x2, y2), (244, 63, 94), 2)
    for oi in only_o:
        ox, oy = [int(round(v)) for v in _det_center(origin_dets[oi])]
        cv2.circle(rgb, (ox, oy), 9, (250, 204, 21), 2, cv2.LINE_AA)
        cv2.circle(rgb, (ox, oy), 2, (250, 204, 21), -1, cv2.LINE_AA)
    return rgb


def _assemble_2x2_panel(
    tiles: list[tuple[np.ndarray, str]],
    header_text: str,
    banner_color: tuple[int, int, int] = (15, 23, 42),
    tile_w: int = 640,
) -> np.ndarray:
    h0, w0 = tiles[0][0].shape[:2]
    tile_h = int(round(h0 * (tile_w / w0)))

    prepped = []
    for img_rgb, title in tiles:
        resized = cv2.resize(img_rgb, (tile_w, tile_h), interpolation=cv2.INTER_AREA)
        bar = np.full((30, tile_w, 3), (15, 23, 42), dtype=np.uint8)
        cv2.putText(bar, title, (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (241, 245, 249), 1, cv2.LINE_AA)
        prepped.append(np.vstack([bar, resized]))

    grid = np.vstack([np.hstack([prepped[0], prepped[1]]), np.hstack([prepped[2], prepped[3]])])
    banner = np.full((40, grid.shape[1], 3), banner_color, dtype=np.uint8)
    fs = 0.58
    while fs > 0.36:
        (tw, _), _ = cv2.getTextSize(header_text, cv2.FONT_HERSHEY_SIMPLEX, fs, 1)
        if tw <= grid.shape[1] - 24:
            break
        fs -= 0.03
    cv2.putText(banner, header_text, (12, 26), cv2.FONT_HERSHEY_SIMPLEX, fs, (255, 255, 255), 1, cv2.LINE_AA)
    return cv2.cvtColor(np.vstack([banner, grid]), cv2.COLOR_RGB2BGR)


def evaluate_val_with_gt(
    model: Any,
    imgsz: int | tuple[int, int],
    val_dir: Path,
    lbl_dir: Path,
    out_dir: Path,
    conf: float,
    iou: float,
    origin_min_conf: float,
) -> dict[str, Any]:
    vis_dir = out_dir / "val_com_gt" / "visuals"
    vis_dir.mkdir(parents=True, exist_ok=True)
    images = sorted(
        p for p in val_dir.glob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS and "_aug_" not in p.stem
    )

    records: list[dict[str, Any]] = []
    agg = {
        "y_tp": 0, "y_fp": 0, "y_fn": 0,
        "o_tp": 0, "o_fp": 0, "o_fn": 0,
        "y_iou50_tp": 0, "y_iou50_fp": 0, "y_iou50_fn": 0,
        "o_iou30_tp": 0, "o_iou30_fp": 0, "o_iou30_fn": 0,
        "both_tp_gt": 0, "only_y_tp_gt": 0, "only_o_tp_gt": 0, "neither_gt": 0,
    }

    for p in images:
        im = cv2.imread(str(p))
        if im is None:
            continue
        h, w = im.shape[:2]
        gt_boxes = _load_yolo_gt(lbl_dir / f"{p.stem}.txt", w, h)

        t0 = time.perf_counter()
        y_res = model(str(p), conf=conf, iou=iou, imgsz=imgsz, verbose=False)[0]
        y_dets = _build_yolo_detections(y_res)
        y_ms = round((time.perf_counter() - t0) * 1000.0, 1)

        t1 = time.perf_counter()
        seg = segment_hairs_grayscale(im)
        o_dets, dbg = detect_bulbs_from_hair_origins(
            im,
            hair_mask=seg.hair_mask,
            scalp_mask=seg.scalp_mask,
            scalp_gray_median=seg.scalp_gray_median,
            min_confidence=origin_min_conf,
            return_debug=True,
        )
        o_ms = round((time.perf_counter() - t1) * 1000.0, 1)

        ym = _match_center_to_gt(y_dets, gt_boxes)
        om = _match_center_to_gt(o_dets, gt_boxes)
        yi50 = _match_iou_to_gt(y_dets, gt_boxes, 0.50)
        oi30 = _match_iou_to_gt(o_dets, gt_boxes, 0.30)

        agg["y_tp"] += ym["tp"]; agg["y_fp"] += ym["fp"]; agg["y_fn"] += ym["fn"]
        agg["o_tp"] += om["tp"]; agg["o_fp"] += om["fp"]; agg["o_fn"] += om["fn"]
        agg["y_iou50_tp"] += yi50[0]; agg["y_iou50_fp"] += yi50[1]; agg["y_iou50_fn"] += yi50[2]
        agg["o_iou30_tp"] += oi30[0]; agg["o_iou30_fp"] += oi30[1]; agg["o_iou30_fn"] += oi30[2]

        # Complementaridade sobre os bulbos reais do GT
        both_gt = len(ym["matched_gt"] & om["matched_gt"])
        only_y_gt = len(ym["matched_gt"] - om["matched_gt"])
        only_o_gt = len(om["matched_gt"] - ym["matched_gt"])
        neither_gt = len(gt_boxes) - len(ym["matched_gt"] | om["matched_gt"])
        agg["both_tp_gt"] += both_gt
        agg["only_y_tp_gt"] += only_y_gt
        agg["only_o_tp_gt"] += only_o_gt
        agg["neither_gt"] += neither_gt

        yp, yr, yf1 = _prf(ym["tp"], ym["fp"], ym["fn"])
        op, or_, of1 = _prf(om["tp"], om["fp"], om["fn"])

        # Visual 2x2
        gt_rgb = cv2.cvtColor(im, cv2.COLOR_BGR2RGB).copy()
        for b in gt_boxes:
            cv2.rectangle(gt_rgb, (int(b[0]), int(b[1])), (int(b[2]), int(b[3])), (34, 197, 94), 2)
        y_eval_rgb = _draw_gt_eval_rgb(im, y_dets, gt_boxes, ym, mode="yolo")
        o_eval_rgb = _draw_gt_eval_rgb(im, o_dets, gt_boxes, om, mode="origin")
        o_mask_rgb = render_origin_bulbs_overlay(im, seg.hair_mask, o_dets, open_scalp=dbg["open_scalp"])

        header = (
            f"VAL GT={len(gt_boxes)} | YOLO: {len(y_dets)} (TP={ym['tp']} FP={ym['fp']} FN={ym['fn']} F1={yf1:.1f}%) "
            f"| ORIGEM v2: {len(o_dets)} (TP={om['tp']} FP={om['fp']} FN={om['fn']} F1={of1:.1f}%)"
        )
        panel = _assemble_2x2_panel(
            [
                (gt_rgb, f"Gabarito Manual (GT = {len(gt_boxes)} bulbos)"),
                (y_eval_rgb, f"YOLO vs GT (Verde=TP {ym['tp']} | Verm=FP {ym['fp']} | Azul=FN {ym['fn']})"),
                (o_eval_rgb, f"Origem v2 (Tracking) vs GT (TP {om['tp']} | FP {om['fp']} | FN {om['fn']})"),
                (o_mask_rgb, f"Costura ({dbg['stitched_links']} links) + Couro bitwise_not ({len(o_dets)} bulbos)"),
            ],
            header_text=header,
            banner_color=(20, 83, 45),
        )
        vis_path = vis_dir / f"{p.stem}_comparativo.png"
        cv2.imwrite(str(vis_path), panel)

        records.append(
            {
                "image": p.name,
                "gt_bulbs": len(gt_boxes),
                "yolo_count": len(y_dets),
                "yolo_tp": ym["tp"],
                "yolo_fp": ym["fp"],
                "yolo_fn": ym["fn"],
                "yolo_precision_pct": yp,
                "yolo_recall_pct": yr,
                "yolo_f1_pct": yf1,
                "yolo_count_acc_pct": _count_accuracy_pct(len(y_dets), len(gt_boxes)),
                "yolo_ms": y_ms,
                "origin_count": len(o_dets),
                "origin_tp": om["tp"],
                "origin_fp": om["fp"],
                "origin_fn": om["fn"],
                "origin_precision_pct": op,
                "origin_recall_pct": or_,
                "origin_f1_pct": of1,
                "origin_count_acc_pct": _count_accuracy_pct(len(o_dets), len(gt_boxes)),
                "origin_ms": o_ms,
                "gt_caught_both": both_gt,
                "gt_caught_only_yolo": only_y_gt,
                "gt_caught_only_origin": only_o_gt,
                "gt_missed_both": neither_gt,
                "visual_panel": str(vis_path),
            }
        )

    total_gt = sum(r["gt_bulbs"] for r in records)
    yp, yr, yf1 = _prf(agg["y_tp"], agg["y_fp"], agg["y_fn"])
    op, or_, of1 = _prf(agg["o_tp"], agg["o_fp"], agg["o_fn"])
    yi_p, yi_r, yi_f1 = _prf(agg["y_iou50_tp"], agg["y_iou50_fp"], agg["y_iou50_fn"])
    oi_p, oi_r, oi_f1 = _prf(agg["o_iou30_tp"], agg["o_iou30_fp"], agg["o_iou30_fn"])

    y_errs = [abs(r["yolo_count"] - r["gt_bulbs"]) for r in records]
    o_errs = [abs(r["origin_count"] - r["gt_bulbs"]) for r in records]

    summary = {
        "images": len(records),
        "total_gt_bulbs": total_gt,
        "yolo": {
            "total_detected": sum(r["yolo_count"] for r in records),
            "tp": agg["y_tp"], "fp": agg["y_fp"], "fn": agg["y_fn"],
            "precision_pct": yp, "recall_pct": yr, "f1_pct": yf1,
            "iou50_f1_pct": yi_f1,
            "count_acc_pct": round(float(np.mean([r["yolo_count_acc_pct"] for r in records])), 2),
            "mae": round(float(np.mean(y_errs)), 2),
            "rmse": round(math.sqrt(float(np.mean([e * e for e in y_errs]))), 2),
            "avg_ms": round(float(np.mean([r["yolo_ms"] for r in records])), 1),
        },
        "origin": {
            "total_detected": sum(r["origin_count"] for r in records),
            "tp": agg["o_tp"], "fp": agg["o_fp"], "fn": agg["o_fn"],
            "precision_pct": op, "recall_pct": or_, "f1_pct": of1,
            "iou30_f1_pct": oi_f1,
            "count_acc_pct": round(float(np.mean([r["origin_count_acc_pct"] for r in records])), 2),
            "mae": round(float(np.mean(o_errs)), 2),
            "rmse": round(math.sqrt(float(np.mean([e * e for e in o_errs]))), 2),
            "avg_ms": round(float(np.mean([r["origin_ms"] for r in records])), 1),
        },
        "complementarity_on_gt": {
            "both_caught": agg["both_tp_gt"],
            "only_yolo_caught": agg["only_y_tp_gt"],
            "only_origin_caught": agg["only_o_tp_gt"],
            "both_missed": agg["neither_gt"],
            "union_recall_pct": round(100.0 * (total_gt - agg["neither_gt"]) / max(1, total_gt), 2),
        },
    }
    return {"summary": summary, "records": records}


def evaluate_unseen_test(
    model: Any,
    imgsz: int | tuple[int, int],
    test_dir: Path,
    out_dir: Path,
    conf: float,
    iou: float,
    origin_min_conf: float,
) -> dict[str, Any]:
    vis_dir = out_dir / "teste_inedito" / "visuals"
    vis_dir.mkdir(parents=True, exist_ok=True)
    images = sorted(
        p for p in test_dir.glob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )

    records: list[dict[str, Any]] = []
    for p in images:
        im = cv2.imread(str(p))
        if im is None:
            continue

        t0 = time.perf_counter()
        y_res = model(str(p), conf=conf, iou=iou, imgsz=imgsz, verbose=False)[0]
        y_dets = _build_yolo_detections(y_res)
        y_ms = round((time.perf_counter() - t0) * 1000.0, 1)

        t1 = time.perf_counter()
        seg = segment_hairs_grayscale(im)
        o_dets, dbg = detect_bulbs_from_hair_origins(
            im,
            hair_mask=seg.hair_mask,
            scalp_mask=seg.scalp_mask,
            scalp_gray_median=seg.scalp_gray_median,
            min_confidence=origin_min_conf,
            return_debug=True,
        )
        o_ms = round((time.perf_counter() - t1) * 1000.0, 1)

        matched, only_y, only_o = _match_detectors(y_dets, o_dets, max_dist_px=20.0)
        union_n = len(matched) + len(only_y) + len(only_o)
        jaccard = round(100.0 * len(matched) / max(1, union_n), 1)

        orig_rgb = cv2.cvtColor(im, cv2.COLOR_BGR2RGB)
        yolo_rgb = _draw_yolo_clean_rgb(im, y_dets)
        origin_rgb = render_origin_bulbs_overlay(im, seg.hair_mask, o_dets, open_scalp=dbg["open_scalp"])
        agree_rgb = _draw_agreement_rgb(im, y_dets, o_dets, matched, only_y, only_o)

        header = (
            f"{p.name} | YOLO: {len(y_dets)} | Origem v2 (Tracking): {len(o_dets)} | "
            f"Concordancia: {len(matched)} ambos | {len(only_y)} so YOLO | {len(only_o)} so Origem"
        )
        panel = _assemble_2x2_panel(
            [
                (orig_rgb, "Imagem Original (Inedita)"),
                (yolo_rgb, f"Modelo YOLO (best.pt) - {len(y_dets)} bulbos"),
                (origin_rgb, f"Origem v2 (Costura {dbg['stitched_links']} + Tracking bitwise_not) - {len(o_dets)}"),
                (agree_rgb, f"Concordancia (Verde={len(matched)} | Rosa=So YOLO {len(only_y)} | Amar=So Orig {len(only_o)})"),
            ],
            header_text=header,
            banner_color=(30, 58, 138),
        )
        vis_path = vis_dir / f"{p.stem}_comparativo.png"
        cv2.imwrite(str(vis_path), panel)

        records.append(
            {
                "image": p.name,
                "yolo_count": len(y_dets),
                "yolo_avg_conf_pct": round(100.0 * float(np.mean([d["confidence"] for d in y_dets])), 1) if y_dets else 0.0,
                "yolo_ms": y_ms,
                "origin_count": len(o_dets),
                "origin_avg_conf_pct": round(100.0 * float(np.mean([d["confidence"] for d in o_dets])), 1) if o_dets else 0.0,
                "origin_ms": o_ms,
                "matched_both": len(matched),
                "only_yolo": len(only_y),
                "only_origin": len(only_o),
                "agreement_jaccard_pct": jaccard,
                "strand_count": seg.strand_count,
                "hair_coverage_pct": seg.hair_coverage_pct,
                "visual_panel": str(vis_path),
            }
        )

    tot_y = sum(r["yolo_count"] for r in records)
    tot_o = sum(r["origin_count"] for r in records)
    tot_both = sum(r["matched_both"] for r in records)
    tot_only_y = sum(r["only_yolo"] for r in records)
    tot_only_o = sum(r["only_origin"] for r in records)
    summary = {
        "images": len(records),
        "yolo_total": tot_y,
        "yolo_avg_per_image": round(tot_y / max(1, len(records)), 2),
        "yolo_avg_ms": round(float(np.mean([r["yolo_ms"] for r in records])), 1),
        "origin_total": tot_o,
        "origin_avg_per_image": round(tot_o / max(1, len(records)), 2),
        "origin_avg_ms": round(float(np.mean([r["origin_ms"] for r in records])), 1),
        "matched_both_total": tot_both,
        "only_yolo_total": tot_only_y,
        "only_origin_total": tot_only_o,
        "pct_yolo_confirmed_by_origin": round(100.0 * tot_both / max(1, tot_y), 1),
        "pct_origin_confirmed_by_yolo": round(100.0 * tot_both / max(1, tot_o), 1),
    }
    return {"summary": summary, "records": records}


def main() -> int:
    parser = argparse.ArgumentParser(description="Comparativo de detecção de bulbos: YOLO vs Origem dos Fios.")
    parser.add_argument("--val-dir", type=Path, default=DEFAULT_VAL_DIR)
    parser.add_argument("--val-labels", type=Path, default=DEFAULT_VAL_LABELS)
    parser.add_argument("--test-dir", type=Path, default=DEFAULT_TEST_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--iou", type=float, default=0.45)
    parser.add_argument("--imgsz", type=str, default="1920x1080")
    parser.add_argument("--origin-conf", type=float, default=0.78)
    args = parser.parse_args()

    out_dir = args.output.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    model = _load_yolo_model()
    imgsz = _parse_yolo_imgsz(args.imgsz)

    val_res = evaluate_val_with_gt(model, imgsz, args.val_dir, args.val_labels, out_dir, args.conf, args.iou, args.origin_conf)
    test_res = evaluate_unseen_test(model, imgsz, args.test_dir, out_dir, args.conf, args.iou, args.origin_conf)

    # Salvar JSON e CSVs
    payload = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "config": {"yolo_conf": args.conf, "yolo_iou": args.iou, "yolo_imgsz": args.imgsz, "origin_min_conf": args.origin_conf},
        "val_with_gt": val_res,
        "unseen_test": test_res,
    }
    (out_dir / "comparison_results.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    for fname, recs in [("val_com_gt_results.csv", val_res["records"]), ("teste_inedito_results.csv", test_res["records"])]:
        if recs:
            with (out_dir / fname).open("w", encoding="utf-8-sig", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=list(recs[0].keys()))
                writer.writeheader()
                writer.writerows(recs)

    # Relatório legível
    vs = val_res["summary"]
    ts = test_res["summary"]
    lines = [
        "=" * 102,
        "COMPARATIVO DE DETECÇÃO DE BULBOS: MODELO YOLO (best.pt) vs ORIGEM DOS FIOS (SEGMENTAÇÃO)",
        "=" * 102,
        f"Data/Hora: {payload['timestamp']}",
        "",
        "1) CONJUNTO DE VALIDAÇÃO COM GABARITO (13 imagens reais não-aumentadas | 286 bulbos GT)",
        "   *Nota técnica: cópias aumentadas (_aug_) dessas imagens constam no treino do YOLO.",
        "-" * 102,
        f"{'Método':<26} {'Detect.':>7} {'TP':>5} {'FP':>5} {'FN':>5} {'Prec%':>7} {'Rec%':>7} {'F1%':>7} {'AccCnt%':>8} {'MAE':>6} {'ms/img':>8}",
        "-" * 102,
        f"{'YOLO (best.pt 1920x1080)':<26} {vs['yolo']['total_detected']:>7} {vs['yolo']['tp']:>5} {vs['yolo']['fp']:>5} {vs['yolo']['fn']:>5} {vs['yolo']['precision_pct']:>6.1f}% {vs['yolo']['recall_pct']:>6.1f}% {vs['yolo']['f1_pct']:>6.1f}% {vs['yolo']['count_acc_pct']:>7.1f}% {vs['yolo']['mae']:>6.2f} {vs['yolo']['avg_ms']:>8.1f}",
        f"{'Origem dos Fios (Seg.)':<26} {vs['origin']['total_detected']:>7} {vs['origin']['tp']:>5} {vs['origin']['fp']:>5} {vs['origin']['fn']:>5} {vs['origin']['precision_pct']:>6.1f}% {vs['origin']['recall_pct']:>6.1f}% {vs['origin']['f1_pct']:>6.1f}% {vs['origin']['count_acc_pct']:>7.1f}% {vs['origin']['mae']:>6.2f} {vs['origin']['avg_ms']:>8.1f}",
        "-" * 102,
        f"Complementaridade nos 286 bulbos GT: Ambos={vs['complementarity_on_gt']['both_caught']} | "
        f"Só YOLO={vs['complementarity_on_gt']['only_yolo_caught']} | "
        f"Só Origem={vs['complementarity_on_gt']['only_origin_caught']} | "
        f"Nenhum={vs['complementarity_on_gt']['both_missed']} (Recall união={vs['complementarity_on_gt']['union_recall_pct']}%)",
        "",
        "2) CONJUNTO DE TESTE INÉDITO (teste_images — 16 imagens nunca vistas pelo YOLO)",
        "-" * 102,
        f"{'Imagem':<42} {'YOLO':>6} {'Origem':>7} {'Ambos':>6} {'SoYOLO':>7} {'SoOrig':>7} {'Y_ms':>7} {'O_ms':>7}",
        "-" * 102,
    ]
    for r in test_res["records"]:
        lines.append(
            f"{r['image']:<42} {r['yolo_count']:>6} {r['origin_count']:>7} {r['matched_both']:>6} "
            f"{r['only_yolo']:>7} {r['only_origin']:>7} {r['yolo_ms']:>7.1f} {r['origin_ms']:>7.1f}"
        )
    lines.extend(
        [
            "-" * 102,
            f"TOTAL / MÉDIA ({ts['images']} imgs): YOLO={ts['yolo_total']} ({ts['yolo_avg_per_image']}/img, {ts['yolo_avg_ms']} ms) | "
            f"Origem={ts['origin_total']} ({ts['origin_avg_per_image']}/img, {ts['origin_avg_ms']} ms)",
            f"CONCORDÂNCIA: {ts['matched_both_total']} em comum | Só YOLO={ts['only_yolo_total']} | Só Origem={ts['only_origin_total']} "
            f"({ts['pct_yolo_confirmed_by_origin']}% do YOLO confirmado pela Origem; {ts['pct_origin_confirmed_by_yolo']}% da Origem confirmada pelo YOLO)",
            "=" * 102,
        ]
    )

    report = "\n".join(lines)
    (out_dir / "comparison_report.txt").write_text(report + "\n", encoding="utf-8")
    print(report)
    print(f"\nPainéis visuais salvos em:\n  - {out_dir / 'val_com_gt' / 'visuals'}\n  - {out_dir / 'teste_inedito' / 'visuals'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
