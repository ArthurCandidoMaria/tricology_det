"""
Segmentação de fios capilares e couro cabeludo via análise de intensidade
em escala de cinza (grayscale) com correção local de iluminação (black-hat),
preenchimento de buracos internos e reconexão direcional de segmentos do mesmo fio
sem fundir fios vizinhos.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any

import cv2
import numpy as np
from skimage.morphology import remove_small_holes, skeletonize


@dataclass
class HairSegmentationResult:
    hair_mask: np.ndarray          # uint8 (H, W), 255 = fio, 0 = couro cabeludo
    scalp_mask: np.ndarray         # uint8 (H, W), 255 = couro cabeludo, 0 = fio
    strand_count: int
    avg_thickness_px: float
    median_thickness_px: float
    hair_coverage_pct: float
    gray_threshold: float
    scalp_gray_median: float
    hair_gray_median: float
    image_width: int
    image_height: int


def _outward_direction(pts: np.ndarray, endpoint: np.ndarray) -> np.ndarray:
    """Calcula o vetor tangente unitário apontando para fora a partir de uma extremidade."""
    dists = np.linalg.norm(pts - endpoint, axis=1)
    near = pts[(dists >= 3.0) & (dists <= 15.0)]
    if len(near) == 0:
        near = pts[dists > 0]
    if len(near) == 0:
        return np.array([0.0, 0.0], dtype=np.float64)
    vec = endpoint.astype(np.float64) - np.mean(near, axis=0)
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 1e-6 else np.array([0.0, 0.0], dtype=np.float64)


def _bridge_collinear_strand_gaps(
    hair_mask: np.ndarray,
    blackhat: np.ndarray,
    max_gap_px: float = 16.0,
    min_align: float = 0.86,
    min_segment_px: int = 10,
) -> np.ndarray:
    """
    Reconecta falhas longitudinais (ex.: reflexo de luz cortando um fio) na máscara
    usando a tangente local nas extremidades do esqueleto.

    Como só une extremidades colineares que apontam uma para a outra ao longo do mesmo eixo,
    NÃO funde fios paralelos adjacentes.
    """
    skel = skeletonize(hair_mask > 0).astype(np.uint8)
    dist = cv2.distanceTransform(hair_mask, cv2.DIST_L2, 5)
    nb_kernel = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.uint8)
    nb_count = cv2.filter2D(skel, -1, nb_kernel) * skel

    junctions = (nb_count >= 3).astype(np.uint8)
    junctions_dilated = cv2.dilate(junctions, np.ones((3, 3), dtype=np.uint8))
    seg_skel = (skel & (1 - junctions_dilated)).astype(np.uint8)
    n_seg, seg_labels, seg_stats, _ = cv2.connectedComponentsWithStats(seg_skel, connectivity=8)

    # Coleta apenas extremidades livres (que também eram extremidades no esqueleto completo)
    free_endpoints = (skel == 1) & (nb_count == 1)
    endpoints: list[dict[str, Any]] = []

    for label_id in range(1, n_seg):
        area = int(seg_stats[label_id, cv2.CC_STAT_AREA])
        if area < min_segment_px:
            continue
        x0 = int(seg_stats[label_id, cv2.CC_STAT_LEFT])
        y0 = int(seg_stats[label_id, cv2.CC_STAT_TOP])
        bw = int(seg_stats[label_id, cv2.CC_STAT_WIDTH])
        bh_box = int(seg_stats[label_id, cv2.CC_STAT_HEIGHT])

        roi_lbl = seg_labels[y0 : y0 + bh_box, x0 : x0 + bw] == label_id
        roi_ep = roi_lbl & free_endpoints[y0 : y0 + bh_box, x0 : x0 + bw]
        if not np.any(roi_ep):
            continue

        pts = np.column_stack(np.where(roi_lbl)) + np.array([y0, x0])  # (y, x)
        ep_pts = np.column_stack(np.where(roi_ep)) + np.array([y0, x0])
        local_dists = dist[pts[:, 0], pts[:, 1]]
        radius = min(4, max(1, int(round(float(np.median(local_dists))))))
        for ep in ep_pts:
            direction = _outward_direction(pts, ep)
            if np.linalg.norm(direction) < 0.5:
                continue
            endpoints.append(
                {
                    "seg_id": label_id,
                    "pt": ep,  # (y, x)
                    "dir": direction,
                    "radius": radius,
                }
            )

    if len(endpoints) < 2:
        return hair_mask

    candidates: list[tuple[float, int, int]] = []
    for i in range(len(endpoints)):
        e1 = endpoints[i]
        for j in range(i + 1, len(endpoints)):
            e2 = endpoints[j]
            if e1["seg_id"] == e2["seg_id"]:
                continue
            gap = float(np.linalg.norm(e2["pt"] - e1["pt"]))
            if gap < 2.0 or gap > max_gap_px:
                continue
            v12 = (e2["pt"] - e1["pt"]) / gap
            align1 = float(np.dot(e1["dir"], v12))
            align2 = float(np.dot(e2["dir"], -v12))
            if align1 >= min_align and align2 >= min_align:
                # Verifica que a linha entre as extremidades não atravessa apenas pele muito clara
                ys = np.linspace(e1["pt"][0], e2["pt"][0], num=max(3, int(round(gap)))).astype(int)
                xs = np.linspace(e1["pt"][1], e2["pt"][1], num=max(3, int(round(gap)))).astype(int)
                mean_bh = float(np.mean(blackhat[ys, xs]))
                # Para lacunas muito curtas (<= 8px, típico de brilho especular) permite ponte direta;
                # para lacunas maiores exige algum sinal escuro residual ao longo do traço.
                if gap <= 8.0 or mean_bh >= 8.0:
                    score = gap / (align1 * align2)
                    candidates.append((score, i, j))

    if not candidates:
        return hair_mask

    candidates.sort(key=lambda item: item[0])
    used: set[int] = set()
    bridged = hair_mask.copy()

    for _, i, j in candidates:
        if i in used or j in used:
            continue
        e1, e2 = endpoints[i], endpoints[j]
        p1_xy = (int(e1["pt"][1]), int(e1["pt"][0]))
        p2_xy = (int(e2["pt"][1]), int(e2["pt"][0]))
        thickness = max(1, min(e1["radius"], e2["radius"]) * 2 - 1)
        cv2.line(bridged, p1_xy, p2_xy, 255, thickness=thickness, lineType=cv2.LINE_8)
        used.add(i)
        used.add(j)

    return bridged


def _count_individual_strands(
    skel: np.ndarray,
    junctions_dilated: np.ndarray,
    min_segment_px: int = 12,
    min_strand_px: int = 22,
    max_bridge_gap_px: float = 22.0,
) -> int:
    """
    Conta fios individuais a partir do esqueleto binário.

    Divide o esqueleto nos pontos de cruzamento (junções com >= 3 vizinhos),
    descarta pequenos ruídos e reconecta segmentos colineares que pertencem
    ao mesmo fio atravessando um cruzamento.
    """
    nb_kernel = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.uint8)
    seg_skel = (skel & (1 - junctions_dilated)).astype(np.uint8)
    n_seg, seg_labels, seg_stats, _ = cv2.connectedComponentsWithStats(seg_skel, connectivity=8)

    segments: list[dict[str, Any]] = []
    for label_id in range(1, n_seg):
        area = int(seg_stats[label_id, cv2.CC_STAT_AREA])
        if area < min_segment_px:
            continue
        x0 = int(seg_stats[label_id, cv2.CC_STAT_LEFT])
        y0 = int(seg_stats[label_id, cv2.CC_STAT_TOP])
        bw = int(seg_stats[label_id, cv2.CC_STAT_WIDTH])
        bh_box = int(seg_stats[label_id, cv2.CC_STAT_HEIGHT])

        sub_mask = (seg_labels[y0 : y0 + bh_box, x0 : x0 + bw] == label_id).astype(np.uint8)
        pts = np.column_stack(np.where(sub_mask > 0)) + np.array([y0, x0])  # (y, x)
        sub_nb = cv2.filter2D(sub_mask, -1, nb_kernel) * sub_mask
        ep_pts = np.column_stack(np.where((sub_mask == 1) & (sub_nb <= 1))) + np.array([y0, x0])

        if len(ep_pts) < 2:
            p0, p1 = pts[0], pts[-1]
        else:
            dmat = np.linalg.norm(ep_pts[:, None, :] - ep_pts[None, :, :], axis=-1)
            idx0, idx1 = np.unravel_index(int(np.argmax(dmat)), dmat.shape)
            p0, p1 = ep_pts[idx0], ep_pts[idx1]

        segments.append(
            {
                "id": label_id,
                "length": area,
                "endpoints": [
                    (p0, _outward_direction(pts, p0)),
                    (p1, _outward_direction(pts, p1)),
                ],
            }
        )

    if not segments:
        return 0

    parent = {seg["id"]: seg["id"] for seg in segments}

    def find(node: int) -> int:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    candidates: list[tuple[float, int, int, int, int]] = []
    for i in range(len(segments)):
        s1 = segments[i]
        for j in range(i + 1, len(segments)):
            s2 = segments[j]
            for ei, (p1, d1) in enumerate(s1["endpoints"]):
                for ej, (p2, d2) in enumerate(s2["endpoints"]):
                    gap = float(np.linalg.norm(p2 - p1))
                    if gap < 2.0 or gap > max_bridge_gap_px:
                        continue
                    v12 = (p2 - p1) / gap
                    align1 = float(np.dot(d1, v12))
                    align2 = float(np.dot(d2, -v12))
                    if align1 > 0.80 and align2 > 0.80:
                        score = gap / (align1 * align2)
                        candidates.append((score, s1["id"], ei, s2["id"], ej))

    candidates.sort(key=lambda item: item[0])
    used_endpoints: set[tuple[int, int]] = set()
    for _, id1, ei, id2, ej in candidates:
        k1, k2 = (id1, ei), (id2, ej)
        if k1 in used_endpoints or k2 in used_endpoints:
            continue
        if find(id1) != find(id2):
            union(id1, id2)
            used_endpoints.add(k1)
            used_endpoints.add(k2)

    strand_lengths: dict[int, int] = {}
    for seg in segments:
        root = find(seg["id"])
        strand_lengths[root] = strand_lengths.get(root, 0) + seg["length"]

    return sum(1 for length in strand_lengths.values() if length >= min_strand_px)


def _close_hair_mask_two_kernels(
    hair_mask: np.ndarray,
    blackhat: np.ndarray,
    soft_bh_guard: float,
    scale: float,
    k1_size: int = 3,
    k2_size: int = 7,
) -> np.ndarray:
    """
    Transformação morfológica de fechamento (MORPH_CLOSE) em 2 kernels para impedir
    que reflexos especulares separem um único fio em duas máscaras:
      - Kernel 1 (cruz 3×3): fecha micro-falhas de 1–2 px guiadas por sinal black-hat.
      - Kernel 2 (elipse 7×7): fecha lacunas de reflexo entre máscaras próximas, preservando
        pontes que realmente conectam >= 2 componentes distintos (ou micro-entalhes escuros)
        sem engordar a parede externa do fio nem fundir fios paralelos vizinhos.
    """
    h, w = hair_mask.shape[:2]
    s1 = max(3, int(round(k1_size * scale)) | 1)
    s2 = max(5, int(round(k2_size * scale)) | 1)

    # Kernel 1: fechamento fino (3×3 em cruz)
    k1 = cv2.getStructuringElement(cv2.MORPH_CROSS, (s1, s1))
    closed_1 = cv2.morphologyEx(hair_mask, cv2.MORPH_CLOSE, k1)
    mask1 = np.where((hair_mask > 0) | ((closed_1 > 0) & (blackhat >= soft_bh_guard)), 255, 0).astype(np.uint8)

    # Kernel 2: fechamento elíptico maior para juntar máscaras próximas separadas por reflexo
    k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (s2, s2))
    closed_2 = cv2.morphologyEx(mask1, cv2.MORPH_CLOSE, k2)
    added = ((closed_2 > 0) & (mask1 == 0)).astype(np.uint8)
    if not np.any(added):
        return mask1

    _, comp_labels = cv2.connectedComponents(mask1, connectivity=8)
    n_add, add_lbl, add_st, _ = cv2.connectedComponentsWithStats(added, connectivity=8)

    max_join_area = int(round((s2 * s2) * 1.4))
    max_join_dim = int(round(s2 * 2.0))
    keep = np.zeros_like(mask1)
    dil_k = np.ones((3, 3), dtype=np.uint8)

    for aid in range(1, n_add):
        area = int(add_st[aid, cv2.CC_STAT_AREA])
        bw = int(add_st[aid, cv2.CC_STAT_WIDTH])
        bh_b = int(add_st[aid, cv2.CC_STAT_HEIGHT])
        if area > max_join_area or max(bw, bh_b) > max_join_dim:
            continue

        x0 = int(add_st[aid, cv2.CC_STAT_LEFT])
        y0 = int(add_st[aid, cv2.CC_STAT_TOP])
        x1, y1 = max(0, x0 - 1), max(0, y0 - 1)
        x2, y2 = min(w, x0 + bw + 1), min(h, y0 + bh_b + 1)

        roi_add = (add_lbl[y1:y2, x1:x2] == aid).astype(np.uint8)
        roi_dil = cv2.dilate(roi_add, dil_k)
        touched = comp_labels[y1:y2, x1:x2][roi_dil > 0]
        unique_comps = {int(v) for v in touched if v > 0}

        if len(unique_comps) >= 2:
            keep[y1:y2, x1:x2][roi_add > 0] = 255

    return cv2.bitwise_or(mask1, keep)


def segment_hairs_grayscale(
    image_bgr: np.ndarray,
    hair_gray_max: int | None = None,
) -> HairSegmentationResult:
    """
    Executa a segmentação de fios e couro cabeludo a partir dos valores de pixel
    em escala de cinza, com reparo morfológico seletivo:
      1. Janela grayscale + black-hat local + núcleo muito escuro (para feixes densos)
      2. Fechamento morfológico leve guiado por intensidade (não atravessa couro cabeludo claro)
      3. Preenchimento de buracos internos pequenos (sem dilatar a borda externa do fio)
      4. Reconexão direcional apenas entre extremidades colineares do mesmo fio
    """
    if image_bgr.ndim == 2:
        gray = image_bgr.copy()
    else:
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

    height, width = gray.shape[:2]
    blur = cv2.GaussianBlur(gray, (3, 3), 0)

    # Estima a iluminação local do couro cabeludo via fechamento morfológico
    ksize = max(15, min(35, (min(height, width) // 25) | 1))
    kernel_bg = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize, ksize))
    scalp_bg = cv2.morphologyEx(blur, cv2.MORPH_CLOSE, kernel_bg)
    blackhat = cv2.subtract(scalp_bg, blur)

    otsu_thresh, _ = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    scalp_median = float(np.median(scalp_bg))

    if hair_gray_max is not None:
        clamped_max = float(max(5, min(250, hair_gray_max)))
        raw_mask = ((blur <= clamped_max) & (blackhat >= 10)).astype(np.uint8) * 255
        applied_threshold = clamped_max
        soft_bh_guard = 8.0
    else:
        bh_otsu, _ = cv2.threshold(blackhat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        bh_thresh = max(18.0, min(float(bh_otsu), 45.0))
        applied_threshold = max(20.0, min(float(otsu_thresh) + 15.0, scalp_median - 15.0))
        raw_mask = ((blackhat >= bh_thresh) & (blur <= applied_threshold)).astype(np.uint8) * 255
        soft_bh_guard = max(10.0, bh_thresh * 0.50)

    # 1. Remove ruídos pontuais (poros, textura da pele) preservando hastes finas
    scale = max(1.0, min(height, width) / 480.0)
    min_area = int(round(25 * scale * scale))
    min_diag = 14.0 * scale

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(raw_mask, connectivity=8)
    hair_mask = np.zeros_like(raw_mask)
    for label_id in range(1, num_labels):
        area = int(stats[label_id, cv2.CC_STAT_AREA])
        bw = int(stats[label_id, cv2.CC_STAT_WIDTH])
        bh_box = int(stats[label_id, cv2.CC_STAT_HEIGHT])
        diag = float(np.hypot(bw, bh_box))
        if area >= min_area and diag >= min_diag:
            hair_mask[labels == label_id] = 255

    # 2. Fechamento morfológico em 2 kernels (cruz 3×3 + elipse 7×7):
    # junta máscaras próximas separadas por reflexos especulares sem engordar a borda
    # externa dos fios nem fundir fios paralelos adjacentes.
    hair_mask = _close_hair_mask_two_kernels(
        hair_mask,
        blackhat=blackhat,
        soft_bh_guard=soft_bh_guard,
        scale=scale,
        k1_size=3,
        k2_size=7,
    )

    # 3. Preenchimento de buracos internos pequenos (ex.: brilho especular no meio do fio)
    # Sem dilatação externa -> zero risco de fundir fios vizinhos.
    max_hole_area = int(round(28 * scale * scale))
    filled_bool = remove_small_holes(hair_mask > 0, area_threshold=max_hole_area, connectivity=1)
    hair_mask = (filled_bool.astype(np.uint8)) * 255

    # 4. Reconexão direcional de lacunas no mesmo fio (apenas extremidades colineares)
    hair_mask = _bridge_collinear_strand_gaps(
        hair_mask,
        blackhat=blackhat,
        max_gap_px=14.0 * scale,
        min_align=0.88,
        min_segment_px=max(8, int(round(10 * scale))),
    )

    # Preenchimento final apenas de micro-buracos internos (<= 16 px²)
    filled_bool = remove_small_holes(hair_mask > 0, area_threshold=max(10, int(round(16 * scale * scale))), connectivity=1)
    hair_mask = (filled_bool.astype(np.uint8)) * 255

    scalp_mask = cv2.bitwise_not(hair_mask)

    # Transformada de distância euclidiana + esqueletização para medir calibre em pixels
    dist = cv2.distanceTransform(hair_mask, cv2.DIST_L2, 5)
    skel = skeletonize(hair_mask > 0).astype(np.uint8)

    nb_kernel = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.uint8)
    nb_count = cv2.filter2D(skel, -1, nb_kernel) * skel
    junctions = (nb_count >= 3).astype(np.uint8)
    junctions_dilated = cv2.dilate(junctions, np.ones((3, 3), dtype=np.uint8))

    # Mede o diâmetro real em pixels (2 * raio - 1 corrige o viés discreto da
    # transformada de distância até o centro do pixel de fundo) fora dos cruzamentos.
    clean_skel = skel & (1 - junctions_dilated)
    radii = dist[clean_skel > 0]
    if len(radii) == 0:
        radii = dist[skel > 0]

    diameters = np.maximum(1.0, radii * 2.0 - 1.0)
    if len(diameters) > 10:
        p5, p95 = np.percentile(diameters, [5, 95])
        trimmed = diameters[(diameters >= p5) & (diameters <= p95)]
        avg_thickness = float(np.mean(trimmed)) if len(trimmed) else float(np.mean(diameters))
        median_thickness = float(np.median(diameters))
    elif len(diameters) > 0:
        avg_thickness = float(np.mean(diameters))
        median_thickness = float(np.median(diameters))
    else:
        avg_thickness = 0.0
        median_thickness = 0.0

    strand_count = _count_individual_strands(
        skel,
        junctions_dilated,
        min_segment_px=max(10, int(round(12 * scale))),
        min_strand_px=max(18, int(round(22 * scale))),
        max_bridge_gap_px=22.0 * scale,
    )

    hair_pixels = gray[hair_mask > 0]
    hair_gray_median = float(np.median(hair_pixels)) if len(hair_pixels) > 0 else 0.0
    hair_coverage_pct = float(np.mean(hair_mask > 0) * 100.0)

    return HairSegmentationResult(
        hair_mask=hair_mask,
        scalp_mask=scalp_mask,
        strand_count=strand_count,
        avg_thickness_px=round(avg_thickness, 2),
        median_thickness_px=round(median_thickness, 2),
        hair_coverage_pct=round(hair_coverage_pct, 1),
        gray_threshold=round(applied_threshold, 1),
        scalp_gray_median=round(scalp_median, 1),
        hair_gray_median=round(hair_gray_median, 1),
        image_width=width,
        image_height=height,
    )


def render_hair_mask_visual(hair_mask: np.ndarray) -> np.ndarray:
    """Renderiza a máscara de fios em RGB de alto contraste (fios em ciano/branco sobre fundo escuro)."""
    h, w = hair_mask.shape[:2]
    canvas = np.full((h, w, 3), (15, 23, 42), dtype=np.uint8)
    active = hair_mask > 0
    canvas[active] = (45, 212, 191)

    eroded = cv2.erode(hair_mask, np.ones((3, 3), dtype=np.uint8), iterations=1)
    canvas[eroded > 0] = (236, 254, 255)
    return canvas


def render_scalp_mask_visual(image_bgr: np.ndarray, scalp_mask: np.ndarray) -> np.ndarray:
    """
    Renderiza a máscara do couro cabeludo em RGB: preserva a região do couro cabeludo
    e remove os fios (substituídos por máscara escura) para avaliação limpa da pele.
    """
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    canvas = np.full_like(image_rgb, (15, 23, 42), dtype=np.uint8)
    scalp_active = scalp_mask > 0
    canvas[scalp_active] = image_rgb[scalp_active]
    return canvas


def render_combined_overlay(
    image_bgr: np.ndarray,
    hair_mask: np.ndarray,
    detections: list[dict[str, Any]],
    open_scalp: np.ndarray | None = None,
) -> np.ndarray:
    """
    Renderiza a imagem clínica combinada em RGB:
    - Fios segmentados destacados com sobreposição semitransparente em turquesa
    - Bulbos detectados via origem dos fios (círculo + ponto central + vetor de emergência + trilha de tracking)
      ou caixas delimitadoras caso a detecção contenha apenas bbox.
    """
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB).copy()
    h, w = rgb.shape[:2]
    scale = max(1.0, min(h, w) / 480.0)

    if open_scalp is not None:
        open_active = open_scalp > 0
        tint_scalp = np.array([147, 197, 253], dtype=np.float32)
        rgb[open_active] = np.clip(rgb[open_active].astype(np.float32) * 0.90 + tint_scalp * 0.10, 0, 255).astype(np.uint8)

    active = hair_mask > 0
    if np.any(active):
        tint = np.array([20, 184, 166], dtype=np.float32)
        rgb[active] = np.clip(rgb[active].astype(np.float32) * 0.58 + tint * 0.42, 0, 255).astype(np.uint8)

    line_thickness = max(2, int(round(2 * scale)))
    radius = max(7, int(round(9 * scale)))
    arrow_len = int(round(12 * scale))
    marker_color = (244, 63, 94)

    for det in detections:
        if "center" in det:
            track_pts = det.get("track_points") or []
            if len(track_pts) >= 2:
                poly = np.array([[int(round(px)), int(round(py))] for px, py in track_pts], dtype=np.int32)
                cv2.polylines(rgb, [poly], False, (34, 211, 238), line_thickness, cv2.LINE_AA)

            cx, cy = [int(round(v)) for v in det["center"]]
            dx, dy = det.get("outward_dir", [0.0, 0.0])
            cv2.circle(rgb, (cx, cy), radius, marker_color, line_thickness, cv2.LINE_AA)
            cv2.circle(rgb, (cx, cy), max(2, int(round(2 * scale))), (250, 204, 21), -1, cv2.LINE_AA)
            if abs(dx) > 1e-3 or abs(dy) > 1e-3:
                ex = int(round(cx + dx * arrow_len))
                ey = int(round(cy + dy * arrow_len))
                cv2.arrowedLine(
                    rgb,
                    (cx, cy),
                    (ex, ey),
                    (250, 204, 21),
                    max(1, line_thickness - 1),
                    cv2.LINE_AA,
                    tipLength=0.35,
                )
        else:
            x1, y1, x2, y2 = [int(round(v)) for v in det["bbox"]]
            cv2.rectangle(rgb, (x1, y1), (x2, y2), marker_color, line_thickness)

    return rgb


def _prune_skeleton_spurs(
    skel: np.ndarray,
    dist: np.ndarray,
    scale: float,
    passes: int = 2,
) -> np.ndarray:
    """Remove pequenos espigões morfológicos (spurs) criados pela esqueletização em cruzamentos."""
    pruned = skel.copy()
    h, w = pruned.shape[:2]
    nb_kernel = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.uint8)

    for _ in range(passes):
        nb_count = cv2.filter2D(pruned, -1, nb_kernel) * pruned
        junctions = (nb_count >= 3).astype(np.uint8)
        if not np.any(junctions):
            break
        junc_dil = cv2.dilate(junctions, np.ones((3, 3), dtype=np.uint8))
        seg_skel = (pruned & (1 - junc_dil)).astype(np.uint8)
        n_seg, seg_labels, seg_stats, _ = cv2.connectedComponentsWithStats(seg_skel, connectivity=8)
        free_ep = (pruned == 1) & (nb_count == 1)

        removed_any = False
        for sid in range(1, n_seg):
            area = int(seg_stats[sid, cv2.CC_STAT_AREA])
            if area == 0 or area > int(round(14 * scale)):
                continue
            x0 = int(seg_stats[sid, cv2.CC_STAT_LEFT])
            y0 = int(seg_stats[sid, cv2.CC_STAT_TOP])
            bw = int(seg_stats[sid, cv2.CC_STAT_WIDTH])
            bh_box = int(seg_stats[sid, cv2.CC_STAT_HEIGHT])
            y1, y2 = max(0, y0 - 1), min(h, y0 + bh_box + 1)
            x1, x2 = max(0, x0 - 1), min(w, x0 + bw + 1)

            roi_seg = seg_labels[y1:y2, x1:x2] == sid
            if int(np.sum(roi_seg & free_ep[y1:y2, x1:x2])) != 1:
                continue
            roi_dil = cv2.dilate(roi_seg.astype(np.uint8), np.ones((3, 3), dtype=np.uint8))
            junc_hit = (roi_dil > 0) & (junctions[y1:y2, x1:x2] > 0)
            if not np.any(junc_hit):
                continue
            junc_r = float(np.median(dist[y1:y2, x1:x2][junc_hit]))
            max_spur_len = max(5, int(round(max(6.0 * scale, 2.3 * junc_r))))
            if area <= max_spur_len:
                pruned[y1:y2, x1:x2][roi_seg] = 0
                removed_any = True
        if not removed_any:
            break

    return pruned


def _extract_ordered_endpoints(pts: np.ndarray, sub_mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Retorna os dois extremos reais (y, x) de um segmento não-ramificado do esqueleto."""
    nb_k = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.uint8)
    sub_nb = cv2.filter2D(sub_mask, -1, nb_k) * sub_mask
    ep_pts = np.column_stack(np.where((sub_mask == 1) & (sub_nb <= 1)))
    if len(ep_pts) < 2:
        return pts[0].astype(np.float64), pts[-1].astype(np.float64)
    dmat = np.linalg.norm(ep_pts[:, None, :] - ep_pts[None, :, :], axis=-1)
    i0, i1 = np.unravel_index(int(np.argmax(dmat)), dmat.shape)
    return ep_pts[i0].astype(np.float64), ep_pts[i1].astype(np.float64)


def _compute_open_scalp_map(
    scalp_mask: np.ndarray,
    gray: np.ndarray,
    scalp_bg: np.ndarray,
    scale: float,
) -> tuple[np.ndarray, np.ndarray, float]:
    """
    Usa a máscara bitwise_not (`scalp_mask = cv2.bitwise_not(hair_mask)`) com
    `connectedComponentsWithStats` e `distanceTransform` para identificar as regiões
    de couro cabeludo aberto ("a cabeça"), filtrando micro-frestas escuras presas
    entre fios sobrepostos.
    """
    h, w = scalp_mask.shape[:2]
    scalp_bin = (scalp_mask > 0).astype(np.uint8)
    scalp_dist = cv2.distanceTransform(scalp_bin * 255, cv2.DIST_L2, 5)
    n_sc, sc_labels, sc_stats, _ = cv2.connectedComponentsWithStats(scalp_bin, connectivity=8)
    scalp_median = float(np.median(scalp_bg))

    min_scalp_area = int(round(120 * scale * scale))
    open_scalp = np.zeros((h, w), dtype=np.uint8)

    for sid in range(1, n_sc):
        area = int(sc_stats[sid, cv2.CC_STAT_AREA])
        if area < min_scalp_area:
            continue
        x0 = int(sc_stats[sid, cv2.CC_STAT_LEFT])
        y0 = int(sc_stats[sid, cv2.CC_STAT_TOP])
        bw = int(sc_stats[sid, cv2.CC_STAT_WIDTH])
        bh_box = int(sc_stats[sid, cv2.CC_STAT_HEIGHT])
        roi_lbl = sc_labels[y0 : y0 + bh_box, x0 : x0 + bw] == sid
        if float(np.max(scalp_dist[y0 : y0 + bh_box, x0 : x0 + bw][roi_lbl])) < 3.5 * scale:
            continue
        if float(np.median(gray[y0 : y0 + bh_box, x0 : x0 + bw][roi_lbl])) < 0.52 * scalp_median:
            continue
        open_scalp[y0 : y0 + bh_box, x0 : x0 + bw][roi_lbl] = 255

    return open_scalp, scalp_dist, scalp_median


def _stitch_hair_components(
    skel: np.ndarray,
    hair_mask: np.ndarray,
    dist: np.ndarray,
    blackhat: np.ndarray,
    scale: float,
    border_margin: int,
) -> tuple[list[dict[str, Any]], int]:
    """
    Decompõe o esqueleto em segmentos elementares com `connectedComponentsWithStats`
    (removendo apenas o pixel de junção para preservar raízes curtas) e junta (stitch)
    os componentes que pertencem ao MESMO fio físico através de cruzamentos e falhas.
    """
    h, w = skel.shape[:2]
    nb_k = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.uint8)
    nb_count = cv2.filter2D(skel, -1, nb_k) * skel
    junctions = (nb_count >= 3).astype(np.uint8)

    _, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats(skel, connectivity=8)
    seg_skel = (skel & (1 - junctions)).astype(np.uint8)
    n_seg, seg_labels, seg_stats, _ = cv2.connectedComponentsWithStats(seg_skel, connectivity=8)

    segments: dict[int, dict[str, Any]] = {}
    for sid in range(1, n_seg):
        area = int(seg_stats[sid, cv2.CC_STAT_AREA])
        if area < 3:
            continue
        x0 = int(seg_stats[sid, cv2.CC_STAT_LEFT])
        y0 = int(seg_stats[sid, cv2.CC_STAT_TOP])
        bw = int(seg_stats[sid, cv2.CC_STAT_WIDTH])
        bh_box = int(seg_stats[sid, cv2.CC_STAT_HEIGHT])

        roi_mask = (seg_labels[y0 : y0 + bh_box, x0 : x0 + bw] == sid).astype(np.uint8)
        pts_rel = np.column_stack(np.where(roi_mask > 0))
        pts = pts_rel + np.array([y0, x0])

        free_pts_local = [pt for pt in pts if nb_count[int(pt[0]), int(pt[1])] == 1]
        if area < max(4, int(round(5 * scale))) and not free_pts_local:
            continue

        p0_rel, p1_rel = _extract_ordered_endpoints(pts_rel, roi_mask)
        p0 = p0_rel + np.array([y0, x0])
        p1 = p1_rel + np.array([y0, x0])

        if len(free_pts_local) == 1:
            fp = free_pts_local[0].astype(np.float64)
            if np.linalg.norm(fp - p0) <= np.linalg.norm(fp - p1):
                p0 = fp
            else:
                p1 = fp
        elif len(free_pts_local) >= 2:
            arr = np.array(free_pts_local, dtype=np.float64)
            dmat = np.linalg.norm(arr[:, None, :] - arr[None, :, :], axis=-1)
            i0, i1 = np.unravel_index(int(np.argmax(dmat)), dmat.shape)
            p0, p1 = arr[i0], arr[i1]

        ccid = int(cc_labels[int(pts[0, 0]), int(pts[0, 1])])
        cc_len = int(cc_stats[ccid, cv2.CC_STAT_AREA])
        cc_x = int(cc_stats[ccid, cv2.CC_STAT_LEFT])
        cc_y = int(cc_stats[ccid, cv2.CC_STAT_TOP])
        cc_w = int(cc_stats[ccid, cv2.CC_STAT_WIDTH])
        cc_h = int(cc_stats[ccid, cv2.CC_STAT_HEIGHT])
        cc_touches_border = (
            (cc_x <= border_margin)
            or (cc_y <= border_margin)
            or (cc_x + cc_w >= w - border_margin)
            or (cc_y + cc_h >= h - border_margin)
        )

        d0 = _outward_direction(pts, p0)
        d1 = _outward_direction(pts, p1)
        if np.linalg.norm(d0) < 0.5 and np.linalg.norm(d1) < 0.5:
            continue

        def end_stats(ep: np.ndarray) -> tuple[float, float, bool]:
            dists = np.linalg.norm(pts - ep, axis=1)
            near = pts[(dists >= 2.0 * scale) & (dists <= 12.0 * scale)]
            if len(near) == 0:
                near = pts
            r_val = float(np.median(dist[near[:, 0], near[:, 1]]))
            bh_val = float(np.median(blackhat[near[:, 0], near[:, 1]]))
            ey, ex = int(round(ep[0])), int(round(ep[1]))
            return r_val, bh_val, bool(nb_count[ey, ex] == 1)

        r0, bh0, free0 = end_stats(p0)
        r1, bh1, free1 = end_stats(p1)

        segments[sid] = {
            "id": sid,
            "ccid": ccid,
            "cc_len": cc_len,
            "cc_touches_border": cc_touches_border,
            "length": area,
            "ends": [
                {"pt": p0, "dir": d0, "r": r0, "bh": bh0, "is_free": free0},
                {"pt": p1, "dir": d1, "r": r1, "bh": bh1, "is_free": free1},
            ],
        }

    # Emparelhamento e costura (stitching) vetorizado dos segmentos do mesmo fio
    seg_ids = list(segments.keys())
    cands_stitch: list[tuple[float, int, int, int, int]] = []
    max_cross_gap = 20.0 * scale
    max_break_gap = 58.0 * scale

    flat_meta: list[tuple[int, int, dict[str, Any]]] = []
    for sid in seg_ids:
        for ei in (0, 1):
            e = segments[sid]["ends"][ei]
            if np.linalg.norm(e["dir"]) >= 0.5:
                flat_meta.append((sid, ei, e))

    if len(flat_meta) >= 2:
        ep_pts = np.array([m[2]["pt"] for m in flat_meta], dtype=np.float64)
        ep_dirs = np.array([m[2]["dir"] for m in flat_meta], dtype=np.float64)
        ep_sids = np.array([m[0] for m in flat_meta], dtype=np.int32)

        diff = ep_pts[None, :, :] - ep_pts[:, None, :]  # (M, M, 2) = p2 - p1
        dist_mat = np.linalg.norm(diff, axis=-1)
        idx_i, idx_j = np.where((ep_sids[:, None] < ep_sids[None, :]) & (dist_mat >= 0.8) & (dist_mat <= max_break_gap))

        if len(idx_i) > 0:
            gaps = dist_mat[idx_i, idx_j]
            v12 = diff[idx_i, idx_j] / gaps[:, None]
            a1_arr = np.einsum("ij,ij->i", ep_dirs[idx_i], v12)
            a2_arr = np.einsum("ij,ij->i", ep_dirs[idx_j], -v12)
            min_align_arr = np.where(gaps <= max_cross_gap, 0.72, 0.82)
            aligned_mask = (a1_arr >= min_align_arr) & (a2_arr >= min_align_arr)

            for k in np.where(aligned_mask)[0]:
                i_m, j_m = int(idx_i[k]), int(idx_j[k])
                id1, ei, e1 = flat_meta[i_m]
                id2, ej, e2 = flat_meta[j_m]
                gap = float(gaps[k])
                a1 = float(a1_arr[k])
                a2 = float(a2_arr[k])

                rmax = max(e1["r"], e2["r"], 1.0)
                if abs(e1["r"] - e2["r"]) > max(1.5, 0.60 * rmax):
                    continue

                n_steps = max(4, int(round(gap)))
                ys = np.clip(np.linspace(e1["pt"][0], e2["pt"][0], n_steps).round().astype(int), 0, h - 1)
                xs = np.clip(np.linspace(e1["pt"][1], e2["pt"][1], n_steps).round().astype(int), 0, w - 1)
                mask_frac = float(np.mean(hair_mask[ys, xs] > 0))
                line_bh = float(np.mean(blackhat[ys, xs]))
                ref_bh = min(e1["bh"], e2["bh"])

                valid = False
                if gap <= max_cross_gap:
                    if (not e1["is_free"] and not e2["is_free"]) or mask_frac >= 0.35 or line_bh >= max(8.5, 0.22 * ref_bh):
                        valid = True
                else:
                    if e1["is_free"] and e2["is_free"] and (line_bh >= max(10.5, 0.26 * ref_bh) or mask_frac >= 0.30):
                        valid = True

                if valid:
                    cands_stitch.append((gap / max(0.1, (a1 * a2) ** 2), id1, ei, id2, ej))

    cands_stitch.sort(key=lambda item: item[0])
    parent = {sid: sid for sid in seg_ids}

    def find(u: int) -> int:
        while parent[u] != u:
            parent[u] = parent[parent[u]]
            u = parent[u]
        return u

    used_ends: set[tuple[int, int]] = set()
    stitched_links = 0
    for _, id1, ei, id2, ej in cands_stitch:
        k1, k2 = (id1, ei), (id2, ej)
        if k1 in used_ends or k2 in used_ends:
            continue
        r1, r2 = find(id1), find(id2)
        if r1 == r2:
            continue
        parent[r1] = r2
        used_ends.add(k1)
        used_ends.add(k2)
        stitched_links += 1

    chains: dict[int, list[int]] = {}
    for sid in seg_ids:
        chains.setdefault(find(sid), []).append(sid)

    strands: list[dict[str, Any]] = []
    for root_id, member_ids in chains.items():
        open_ends = []
        for sid in member_ids:
            for ei in (0, 1):
                if (sid, ei) not in used_ends:
                    e = dict(segments[sid]["ends"][ei])
                    e["seg_len"] = segments[sid]["length"]
                    open_ends.append(e)
        strands.append(
            {
                "strand_id": root_id,
                "total_len": sum(segments[sid]["length"] for sid in member_ids),
                "max_cc_len": max(segments[sid]["cc_len"] for sid in member_ids),
                "any_cc_border": any(segments[sid]["cc_touches_border"] for sid in member_ids),
                "open_ends": open_ends,
            }
        )

    return strands, stitched_links


def _track_strand_end_to_scalp(
    start_pt: np.ndarray,
    start_dir: np.ndarray,
    shaft_r: float,
    shaft_bh: float,
    hair_mask: np.ndarray,
    open_scalp: np.ndarray,
    scalp_dist: np.ndarray,
    blackhat: np.ndarray,
    gray: np.ndarray,
    scalp_median: float,
    scale: float,
    border_margin: int,
    max_track_px: float = 34.0,
) -> dict[str, Any]:
    """
    Faz tracking direcional da extremidade de um fio reconstruído até a entrada
    no couro cabeludo aberto (máscara `bitwise_not` -> `open_scalp` + `scalp_dist`).
    Se o tracking reentrar em outro fio ou sair na borda, descarta a ponta.
    """
    h, w = hair_mask.shape[:2]
    curr_y, curr_x = float(start_pt[0]), float(start_pt[1])
    dir_y, dir_x = float(start_dir[0]), float(start_dir[1])

    # 1) Sai primeiro da própria espessura da ponta na máscara binária
    exit_dist = 0.0
    max_exit = max(5.0, (shaft_r + 3.0) * scale)
    exited = False
    while exit_dist <= max_exit:
        iy, ix = int(round(curr_y)), int(round(curr_x))
        if iy < border_margin or iy >= h - border_margin or ix < border_margin or ix >= w - border_margin:
            return {"status": "border"}
        if hair_mask[iy, ix] == 0:
            exited = True
            break
        curr_y += dir_y
        curr_x += dir_x
        exit_dist += 1.0

    if not exited:
        return {"status": "hit_hair"}

    origin_y, origin_x = curr_y, curr_x
    track_points = [(float(start_pt[1]), float(start_pt[0])), (origin_x, origin_y)]

    # 2) Tracking direcional fino (cone ±20°) seguindo eventual traço residual até o óstio
    cont_bh_thresh = max(14.0, 0.40 * shaft_bh)
    step_px = max(1.5, 1.5 * scale)
    max_steps = int(round(max_track_px * scale / step_px))
    angles_deg = (-20.0, -10.0, 0.0, 10.0, 20.0)

    tracked_steps = 0
    for step in range(1, max_steps + 1):
        best_bh = -1.0
        best_cand = None
        best_dir = (dir_y, dir_x)
        hit_other_hair = False

        base_ang = math.atan2(dir_y, dir_x)
        for deg in angles_deg:
            ang = base_ang + math.radians(deg)
            dy, dx = math.sin(ang), math.cos(ang)
            ny = curr_y + dy * step_px
            nx = curr_x + dx * step_px
            iy, ix = int(round(ny)), int(round(nx))
            if iy < border_margin or iy >= h - border_margin or ix < border_margin or ix >= w - border_margin:
                return {"status": "border"}
            if hair_mask[iy, ix] > 0 and abs(deg) <= 12.0:
                hit_other_hair = True
            val = float(blackhat[iy, ix]) * (1.0 - 0.004 * abs(deg))
            if val > best_bh:
                best_bh = val
                best_cand = (ny, nx)
                best_dir = (dy, dx)

        if hit_other_hair:
            return {"status": "hit_hair"}

        if best_bh >= cont_bh_thresh and best_cand is not None:
            curr_y, curr_x = best_cand
            dir_y = 0.72 * dir_y + 0.28 * best_dir[0]
            dir_x = 0.72 * dir_x + 0.28 * best_dir[1]
            nrm = math.hypot(dir_y, dir_x)
            if nrm > 1e-6:
                dir_y /= nrm
                dir_x /= nrm
            tracked_steps = step
            track_points.append((curr_x, curr_y))
        else:
            break

    if tracked_steps * step_px >= 24.0 * scale:
        return {"status": "faded_continuation"}

    # 3) Validação de aterrissagem no couro cabeludo aberto (`open_scalp` + `scalp_dist`)
    iy, ix = int(round(curr_y)), int(round(curr_x))
    ray_hits = 0
    ray_bhs: list[float] = []
    ray_open: list[float] = []
    ray_sdist: list[float] = []
    for d in range(2, int(round(18 * scale)) + 1):
        ry = int(round(curr_y + dir_y * d))
        rx = int(round(curr_x + dir_x * d))
        if 0 <= ry < h and 0 <= rx < w:
            if d <= int(round(12 * scale)) and hair_mask[ry, rx] > 0:
                ray_hits += 1
            if d >= int(round(3 * scale)):
                ray_bhs.append(float(blackhat[ry, rx]))
                ray_open.append(1.0 if open_scalp[ry, rx] > 0 else 0.0)
                ray_sdist.append(float(scalp_dist[ry, rx]))

    if ray_hits >= 3:
        return {"status": "ray_hit_hair"}

    fwd_bh = float(np.mean(ray_bhs)) if ray_bhs else 99.0
    fwd_open_frac = float(np.mean(ray_open)) if ray_open else 0.0
    fwd_sdist = float(np.max(ray_sdist)) if ray_sdist else 0.0

    f_cy = int(round(curr_y + dir_y * 9.0 * scale))
    f_cx = int(round(curr_x + dir_x * 9.0 * scale))
    rad = max(7, int(round(8.0 * scale)))
    y1, y2 = max(0, f_cy - rad), min(h, f_cy + rad + 1)
    x1, x2 = max(0, f_cx - rad), min(w, f_cx + rad + 1)
    if y2 <= y1 or x2 <= x1:
        return {"status": "border"}

    patch_open = open_scalp[y1:y2, x1:x2]
    patch_gray = gray[y1:y2, x1:x2]
    open_disk_frac = float(np.mean(patch_open > 0))
    open_pix = patch_gray[patch_open > 0]
    open_gray = float(np.mean(open_pix)) if len(open_pix) > 0 else 0.0

    rr = max(12, int(round(14.0 * scale)))
    ry1, ry2 = max(0, iy - rr), min(h, iy + rr + 1)
    rx1, rx2 = max(0, ix - rr), min(w, ix + rr + 1)
    ring_open_frac = float(np.mean(open_scalp[ry1:ry2, rx1:rx2] > 0))

    final_pt = (
        np.array([curr_y, curr_x], dtype=np.float64)
        if tracked_steps > 0
        else np.array([origin_y, origin_x], dtype=np.float64)
    )

    return {
        "status": "scalp_origin",
        "pt": final_pt,
        "dir": np.array([dir_y, dir_x], dtype=np.float64),
        "tracked_px": round(tracked_steps * step_px, 1),
        "track_points": track_points,
        "fwd_bh": fwd_bh,
        "bh_ratio": fwd_bh / max(shaft_bh, 1.0),
        "fwd_open_frac": fwd_open_frac,
        "open_disk_frac": open_disk_frac,
        "ring_open_frac": ring_open_frac,
        "fwd_sdist": fwd_sdist,
        "open_gray_ratio": open_gray / max(scalp_median, 1.0),
    }


def detect_bulbs_from_hair_origins(
    image_bgr: np.ndarray,
    hair_mask: np.ndarray | None = None,
    scalp_gray_median: float | None = None,
    min_confidence: float = 0.72,
    scalp_mask: np.ndarray | None = None,
    return_debug: bool = False,
) -> list[dict[str, Any]] | tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Detecta e conta bulbos (unidades foliculares) sem rede neural a partir da segmentação:
      1. Máscara `bitwise_not` do couro cabeludo + `connectedComponentsWithStats` + `distanceTransform`
         para isolar o couro cabeludo aberto ("a cabeça") de frestas escuras entre fios.
      2. Decomposição da máscara de fios com `connectedComponentsWithStats` e costura (*stitching*)
         de segmentos pertencentes ao mesmo fio através de cruzamentos e falhas de brilho/desfoque.
      3. Tracking direcional de cada fio reconstruído até o ponto exato de entrada no couro cabeludo aberto,
         priorizando sempre a extremidade mais grossa do fio (onde reside o bulbo/óstio folicular).
      4. Agrupamento de unidades foliculares multi-fio (1 óstio -> 1 bulbo).
    """
    if image_bgr.ndim == 2:
        gray = image_bgr.copy()
    else:
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

    h, w = gray.shape[:2]
    scale = max(1.0, min(h, w) / 480.0)

    if hair_mask is None:
        seg = segment_hairs_grayscale(image_bgr)
        hair_mask = seg.hair_mask
        scalp_mask = seg.scalp_mask
        scalp_gray_median = seg.scalp_gray_median
    elif scalp_mask is None:
        scalp_mask = cv2.bitwise_not(hair_mask)

    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    ksize = max(15, min(35, (min(h, w) // 25) | 1))
    kernel_bg = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize, ksize))
    scalp_bg = cv2.morphologyEx(blur, cv2.MORPH_CLOSE, kernel_bg)
    blackhat = cv2.subtract(scalp_bg, blur)
    lap = np.abs(cv2.Laplacian(blur, cv2.CV_32F, ksize=3))

    # 1. Identificação do couro cabeludo aberto via bitwise_not
    open_scalp, scalp_dist, scalp_med_calc = _compute_open_scalp_map(scalp_mask, gray, scalp_bg, scale)
    scalp_median = float(scalp_gray_median) if scalp_gray_median is not None else scalp_med_calc

    # 2. Esqueletização + poda de espigões + stitching de componentes do mesmo fio
    dist = cv2.distanceTransform(hair_mask, cv2.DIST_L2, 5)
    skel = skeletonize(hair_mask > 0).astype(np.uint8)
    skel = _prune_skeleton_spurs(skel, dist, scale=scale, passes=2)

    # Calibre mediano global dos fios na imagem (referência para identificar a extremidade grossa / bulbo)
    skel_radii = dist[skel > 0]
    img_med_r = float(np.median(skel_radii)) if len(skel_radii) > 0 else 1.5

    border_margin = max(7, int(round(7 * scale)))
    strands, stitched_links = _stitch_hair_components(skel, hair_mask, dist, blackhat, scale, border_margin)

    def is_border(pt: np.ndarray) -> bool:
        return (
            pt[1] < border_margin
            or pt[1] >= w - border_margin
            or pt[0] < border_margin
            or pt[0] >= h - border_margin
        )

    # 3. Tracking direcional de cada fio até o couro cabeludo aberto (priorizando a extremidade mais grossa)
    candidates: list[dict[str, Any]] = []
    min_cc_len = int(round(18 * scale))
    min_isolated_len = int(round(30 * scale))
    thick_weight = 0.26
    w_rest = 1.0 - thick_weight

    for strand in strands:
        if strand["max_cc_len"] < min_cc_len:
            continue
        open_ends = strand["open_ends"]
        if not open_ends:
            continue

        touches_border = strand["any_cc_border"] or any(is_border(e["pt"]) for e in open_ends)
        max_strand_end_r = max(e["r"] for e in open_ends)
        strand_cands: list[dict[str, Any]] = []

        for e in open_ends:
            if is_border(e["pt"]) or not e["is_free"] or np.linalg.norm(e["dir"]) < 0.5:
                continue

            rel_img_r = e["r"] / max(img_med_r, 0.75)
            rel_strand_r = e["r"] / max(max_strand_end_r, 0.75)

            res = _track_strand_end_to_scalp(
                start_pt=e["pt"],
                start_dir=e["dir"],
                shaft_r=e["r"],
                shaft_bh=e["bh"],
                hair_mask=hair_mask,
                open_scalp=open_scalp,
                scalp_dist=scalp_dist,
                blackhat=blackhat,
                gray=gray,
                scalp_median=scalp_median,
                scale=scale,
                border_margin=border_margin,
            )
            if res["status"] != "scalp_origin":
                continue
            if res["open_disk_frac"] < 0.65 or res["fwd_open_frac"] < 0.62:
                continue
            if res["ring_open_frac"] < 0.48 or res["fwd_sdist"] < 4.5 * scale:
                continue
            if res["open_gray_ratio"] < 0.62:
                continue
            if res["bh_ratio"] > 0.46 or res["fwd_bh"] > 21.0:
                continue

            oy, ox = int(round(res["pt"][0])), int(round(res["pt"][1]))
            rw = int(round(20 * scale))
            wide_open = float(
                np.mean(
                    open_scalp[max(0, oy - rw) : min(h, oy + rw + 1), max(0, ox - rw) : min(w, ox + rw + 1)] > 0
                )
            )
            if wide_open < 0.42:
                continue

            ly1, ly2 = max(0, oy - 8), min(h, oy + 9)
            lx1, lx2 = max(0, ox - 8), min(w, ox + 9)
            local_sharpness = float(np.percentile(lap[ly1:ly2, lx1:lx2], 90))

            contrast_score = float(np.clip(1.0 - res["bh_ratio"] / 0.55, 0.0, 1.0))
            scalp_score = float(np.clip((res["open_disk_frac"] - 0.55) / 0.45, 0.0, 1.0))
            open_wide_score = float(np.clip((wide_open - 0.35) / 0.45, 0.0, 1.0))
            sharp_score = float(np.clip((local_sharpness - 12.0) / 36.0, 0.0, 1.0))
            # Critério de calibre: combina espessura relativa à imagem + ser a extremidade mais grossa do fio
            thick_score = float(
                np.clip(0.65 * ((rel_img_r - 0.55) / 0.65) + 0.35 * ((rel_strand_r - 0.60) / 0.40), 0.0, 1.0)
            )
            len_score = float(np.clip((strand["total_len"] - 8.0 * scale) / (45.0 * scale), 0.0, 1.0))
            border_bonus = 0.10 if touches_border else 0.0

            conf = float(
                np.clip(
                    thick_weight * thick_score
                    + w_rest
                    * (
                        0.33 * contrast_score
                        + 0.24 * scalp_score
                        + 0.16 * open_wide_score
                        + 0.15 * sharp_score
                        + 0.12 * len_score
                    )
                    + border_bonus,
                    0.0,
                    0.99,
                )
            )
            strand_cands.append(
                {
                    "pt": res["pt"],
                    "dir": res["dir"],
                    "tracked_px": res["tracked_px"],
                    "track_points": res["track_points"],
                    "r": e["r"],
                    "rel_img_r": rel_img_r,
                    "confidence": conf,
                }
            )

        if not strand_cands:
            continue
        # Um fio físico tem 1 bulbo — escolhe sempre a extremidade mais grossa e bem fundamentada
        if touches_border:
            candidates.append(max(strand_cands, key=lambda c: c["confidence"] + 0.25 * c["rel_img_r"]))
        elif strand["total_len"] >= min_isolated_len:
            candidates.append(max(strand_cands, key=lambda c: c["confidence"] + 0.35 * c["rel_img_r"]))

    candidates = [c for c in candidates if c["confidence"] >= min_confidence]

    # 4. Agrupamento de unidades foliculares multi-fio (mesmo óstio)
    candidates.sort(key=lambda c: c["confidence"], reverse=True)
    used = [False] * len(candidates)
    clusters: list[list[dict[str, Any]]] = []
    merge_any = 13.5 * scale
    merge_same_dir = 21.0 * scale

    for i, c1 in enumerate(candidates):
        if used[i]:
            continue
        used[i] = True
        cluster = [c1]
        for j in range(i + 1, len(candidates)):
            if used[j]:
                continue
            c2 = candidates[j]
            d = float(np.linalg.norm(c1["pt"] - c2["pt"]))
            if d <= merge_any or (d <= merge_same_dir and float(np.dot(c1["dir"], c2["dir"])) >= 0.48):
                used[j] = True
                cluster.append(c2)
        clusters.append(cluster)

    box_half = 11.0 * scale
    detections: list[dict[str, Any]] = []
    for idx, cl in enumerate(clusters):
        weights = np.array([c["confidence"] for c in cl], dtype=np.float64)
        pts = np.array([c["pt"] for c in cl], dtype=np.float64)
        dirs = np.array([c["dir"] for c in cl], dtype=np.float64)
        mean_pt = np.average(pts, axis=0, weights=weights)
        mean_dir = np.average(dirs, axis=0, weights=weights)
        dn = float(np.linalg.norm(mean_dir))
        if dn > 1e-6:
            mean_dir = mean_dir / dn

        cy = float(np.clip(mean_pt[0], 0, h - 1))
        cx = float(np.clip(mean_pt[1], 0, w - 1))
        x1 = max(0.0, cx - box_half)
        y1 = max(0.0, cy - box_half)
        x2 = min(float(w), cx + box_half)
        y2 = min(float(h), cy + box_half)

        best_member = cl[0]
        detections.append(
            {
                "id": idx + 1,
                "class_id": 0,
                "class": "bulbo",
                "label": "bulbo_origem",
                "confidence": round(float(max(c["confidence"] for c in cl)), 4),
                "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
                "center": [round(cx, 2), round(cy, 2)],
                "outward_dir": [round(float(mean_dir[1]), 4), round(float(mean_dir[0]), 4)],
                "strands_in_unit": len(cl),
                "tracked_px": round(float(np.mean([c["tracked_px"] for c in cl])), 1),
                "track_points": best_member["track_points"],
            }
        )

    if return_debug:
        return detections, {
            "open_scalp": open_scalp,
            "stitched_strands": len(strands),
            "stitched_links": stitched_links,
        }
    return detections


def render_origin_bulbs_overlay(
    image_bgr: np.ndarray,
    hair_mask: np.ndarray,
    origin_detections: list[dict[str, Any]],
    open_scalp: np.ndarray | None = None,
) -> np.ndarray:
    """
    Renderiza em RGB os bulbos detectados via costura de fios + tracking até o couro cabeludo:
    - Fios segmentados em turquesa suave
    - Contorno sutil do couro cabeludo aberto (`bitwise_not`) quando fornecido
    - Trajetória de tracking em ciano + círculo âmbar no ponto de entrada (bulbo) + vetor de saída
    """
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB).copy()
    h, w = rgb.shape[:2]
    scale = max(1.0, min(h, w) / 480.0)

    if open_scalp is not None:
        # Destaca sutilmente o couro cabeludo aberto (bitwise_not) em tom lavanda/azul-gelo bem leve
        open_active = open_scalp > 0
        tint_scalp = np.array([147, 197, 253], dtype=np.float32)
        rgb[open_active] = np.clip(rgb[open_active].astype(np.float32) * 0.88 + tint_scalp * 0.12, 0, 255).astype(np.uint8)

    active = hair_mask > 0
    if np.any(active):
        tint = np.array([20, 184, 166], dtype=np.float32)
        rgb[active] = np.clip(rgb[active].astype(np.float32) * 0.65 + tint * 0.35, 0, 255).astype(np.uint8)

    radius = max(7, int(round(9 * scale)))
    thick = max(2, int(round(2 * scale)))
    arrow_len = int(round(13 * scale))

    for det in origin_detections:
        track_pts = det.get("track_points") or []
        if len(track_pts) >= 2:
            poly = np.array([[int(round(px)), int(round(py))] for px, py in track_pts], dtype=np.int32)
            cv2.polylines(rgb, [poly], False, (34, 211, 238), max(2, thick), cv2.LINE_AA)

        cx, cy = [int(round(v)) for v in det["center"]]
        dx, dy = det.get("outward_dir", [0.0, 0.0])
        cv2.circle(rgb, (cx, cy), radius, (250, 204, 21), thick, cv2.LINE_AA)
        cv2.circle(rgb, (cx, cy), max(2, int(round(2 * scale))), (234, 88, 12), -1, cv2.LINE_AA)
        if abs(dx) > 1e-3 or abs(dy) > 1e-3:
            ex = int(round(cx + dx * arrow_len))
            ey = int(round(cy + dy * arrow_len))
            cv2.arrowedLine(rgb, (cx, cy), (ex, ey), (56, 189, 248), max(1, thick - 1), cv2.LINE_AA, tipLength=0.35)

    return rgb
