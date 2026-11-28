from __future__ import annotations

import base64
import io
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image

from hair_segmentation import (
    detect_bulbs_from_hair_origins,
    render_combined_overlay,
    render_hair_mask_visual,
    render_scalp_mask_visual,
    segment_hairs_grayscale,
)

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "hair_analysis.db")))
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", str(BASE_DIR / "storage")))
TMP_DIR = BASE_DIR / "tmp"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
TMP_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="FollicleTrack — Hair & Trichometry API", version="2.0.0")

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
configured_origins = os.getenv("CORS_ORIGINS")
if configured_origins:
    origins.extend(part.strip() for part in configured_origins.split(",") if part.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(origins)),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/storage", StaticFiles(directory=str(STORAGE_DIR)), name="storage")

BULB_DETECTION_METHOD = "hair-origin-tracking-v3"

ALLOWED_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _ensure_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]) -> None:
    existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    for col_name, col_type in columns.items():
        if col_name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}")


def init_db() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    with get_db_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS patients (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                date_of_birth TEXT,
                cpf TEXT,
                phone TEXT,
                email TEXT,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                session_date TEXT NOT NULL,
                total_hairs REAL,
                avg_strands REAL,
                avg_thickness_px REAL,
                avg_coverage_pct REAL,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS session_photos (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                scalp_area TEXT NOT NULL,
                photo_url TEXT NOT NULL,
                annotated_photo_url TEXT,
                hair_mask_url TEXT,
                scalp_mask_url TEXT,
                hair_count REAL,
                strand_count INTEGER,
                avg_thickness_px REAL,
                hair_coverage_pct REAL,
                gray_threshold REAL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
            """
        )

        # Migração segura para bancos SQLite já existentes
        _ensure_columns(
            conn,
            "sessions",
            {
                "avg_strands": "REAL",
                "avg_thickness_px": "REAL",
                "avg_coverage_pct": "REAL",
            },
        )
        _ensure_columns(
            conn,
            "session_photos",
            {
                "hair_mask_url": "TEXT",
                "scalp_mask_url": "TEXT",
                "strand_count": "INTEGER",
                "avg_thickness_px": "REAL",
                "hair_coverage_pct": "REAL",
                "gray_threshold": "REAL",
            },
        )


init_db()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_storage_url(url: str | None) -> str | None:
    if not url:
        return url

    normalized = url.replace("\\", "/")
    normalized = normalized.replace("/storage/session-photos/session-photos/", "/storage/session-photos/")
    normalized = normalized.replace("/storage/session-photos//", "/storage/session-photos/")
    return normalized


def build_public_url(bucket: str, object_name: str) -> str:
    base_url = os.getenv("API_BASE_URL", "").rstrip("/")
    normalized = object_name.replace("\\", "/").lstrip("/")
    encoded_parts = "/".join(part for part in normalized.split("/") if part)

    if not encoded_parts:
        return f"{base_url}/storage/{bucket}"

    cleaned = encoded_parts.replace(f"{bucket}/{bucket}/", f"{bucket}/")
    if cleaned.startswith(f"{bucket}/"):
        return f"{base_url}/storage/{cleaned}"

    return f"{base_url}/storage/{bucket}/{cleaned}"


def _mean_or_none(values: list[float | int | None], decimals: int = 2) -> float | None:
    valid = [float(v) for v in values if v is not None]
    if not valid:
        return None
    avg = sum(valid) / len(valid)
    return round(avg, decimals) if decimals > 0 else float(round(avg))


def recalculate_session_metrics(conn: sqlite3.Connection, session_id: str) -> None:
    rows = conn.execute(
        """
        SELECT hair_count, strand_count, avg_thickness_px, hair_coverage_pct
        FROM session_photos
        WHERE session_id = ?
        """,
        (session_id,),
    ).fetchall()

    if not rows:
        return

    total_hairs = _mean_or_none([r["hair_count"] for r in rows], decimals=0)
    avg_strands = _mean_or_none([r["strand_count"] for r in rows], decimals=1)
    avg_thickness = _mean_or_none([r["avg_thickness_px"] for r in rows], decimals=2)
    avg_coverage = _mean_or_none([r["hair_coverage_pct"] for r in rows], decimals=1)

    conn.execute(
        """
        UPDATE sessions
        SET total_hairs = COALESCE(?, total_hairs),
            avg_strands = ?,
            avg_thickness_px = ?,
            avg_coverage_pct = ?
        WHERE id = ?
        """,
        (total_hairs, avg_strands, avg_thickness, avg_coverage, session_id),
    )


def list_patients() -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT p.*,
                   (SELECT COUNT(*) FROM sessions s WHERE s.patient_id = p.id) AS session_count,
                   (SELECT MAX(s.session_date) FROM sessions s WHERE s.patient_id = p.id) AS last_session_date
            FROM patients p
            ORDER BY p.created_at DESC
            """
        ).fetchall()
    return [dict(row) for row in rows]


def create_patient(payload: dict[str, Any]) -> dict[str, Any]:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="O nome do paciente é obrigatório.")

    patient_id = payload.get("id") or uuid.uuid4().hex
    values = {
        "id": patient_id,
        "name": name,
        "date_of_birth": payload.get("date_of_birth") or None,
        "cpf": payload.get("cpf") or None,
        "phone": payload.get("phone") or None,
        "email": payload.get("email") or None,
        "notes": payload.get("notes") or None,
        "created_at": utc_now(),
    }
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO patients (id, name, date_of_birth, cpf, phone, email, notes, created_at)
            VALUES (:id, :name, :date_of_birth, :cpf, :phone, :email, :notes, :created_at)
            """,
            values,
        )
    return {**values, "session_count": 0, "last_session_date": None}


def update_patient(patient_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    allowed = ("name", "date_of_birth", "cpf", "phone", "email", "notes")
    updates = {k: payload[k] for k in allowed if k in payload}
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")

    if "name" in updates and not str(updates["name"] or "").strip():
        raise HTTPException(status_code=400, detail="O nome do paciente não pode ficar vazio.")

    assignments = ", ".join(f"{key} = ?" for key in updates)
    with get_db_connection() as conn:
        cursor = conn.execute(
            f"UPDATE patients SET {assignments} WHERE id = ?",
            (*updates.values(), patient_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Paciente não encontrado.")
        row = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    return dict(row)


def list_session_photos(session_id: str) -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM session_photos WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        ).fetchall()

    result: list[dict[str, Any]] = []
    for row in rows:
        photo = dict(row)
        photo["photo_url"] = normalize_storage_url(photo.get("photo_url")) or ""
        photo["annotated_photo_url"] = normalize_storage_url(photo.get("annotated_photo_url"))
        photo["hair_mask_url"] = normalize_storage_url(photo.get("hair_mask_url"))
        photo["scalp_mask_url"] = normalize_storage_url(photo.get("scalp_mask_url"))
        result.append(photo)
    return result


def create_session(payload: dict[str, Any]) -> dict[str, Any]:
    session_id = payload.get("id") or uuid.uuid4().hex
    session_values = {
        "id": session_id,
        "patient_id": payload.get("patient_id"),
        "session_date": payload.get("session_date"),
        "total_hairs": payload.get("total_hairs"),
        "avg_strands": payload.get("avg_strands"),
        "avg_thickness_px": payload.get("avg_thickness_px"),
        "avg_coverage_pct": payload.get("avg_coverage_pct"),
        "notes": payload.get("notes") or None,
        "created_at": utc_now(),
    }

    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO sessions (
                id, patient_id, session_date, total_hairs,
                avg_strands, avg_thickness_px, avg_coverage_pct, notes, created_at
            )
            VALUES (
                :id, :patient_id, :session_date, :total_hairs,
                :avg_strands, :avg_thickness_px, :avg_coverage_pct, :notes, :created_at
            )
            """,
            session_values,
        )

        photos = payload.get("photos") or []
        for photo in photos:
            conn.execute(
                """
                INSERT INTO session_photos (
                    id, session_id, scalp_area, photo_url, annotated_photo_url,
                    hair_mask_url, scalp_mask_url, hair_count, strand_count,
                    avg_thickness_px, hair_coverage_pct, gray_threshold, created_at
                )
                VALUES (
                    :id, :session_id, :scalp_area, :photo_url, :annotated_photo_url,
                    :hair_mask_url, :scalp_mask_url, :hair_count, :strand_count,
                    :avg_thickness_px, :hair_coverage_pct, :gray_threshold, :created_at
                )
                """,
                {
                    "id": uuid.uuid4().hex,
                    "session_id": session_id,
                    "scalp_area": photo.get("scalp_area") or "unknown",
                    "photo_url": normalize_storage_url(photo.get("photo_url") or ""),
                    "annotated_photo_url": normalize_storage_url(photo.get("annotated_photo_url")),
                    "hair_mask_url": normalize_storage_url(photo.get("hair_mask_url")),
                    "scalp_mask_url": normalize_storage_url(photo.get("scalp_mask_url")),
                    "hair_count": photo.get("hair_count"),
                    "strand_count": photo.get("strand_count"),
                    "avg_thickness_px": photo.get("avg_thickness_px"),
                    "hair_coverage_pct": photo.get("hair_coverage_pct"),
                    "gray_threshold": photo.get("gray_threshold"),
                    "created_at": utc_now(),
                },
            )

        if photos:
            recalculate_session_metrics(conn, session_id)

        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()

    return {**dict(row), "session_photos": list_session_photos(session_id)}


def list_sessions_for_patient(patient_id: str) -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions WHERE patient_id = ? ORDER BY session_date ASC, created_at ASC",
            (patient_id,),
        ).fetchall()

    sessions: list[dict[str, Any]] = []
    for row in rows:
        session = dict(row)
        session["session_photos"] = list_session_photos(session["id"])
        sessions.append(session)
    return sessions


def create_session_photo(payload: dict[str, Any]) -> dict[str, Any]:
    photo_id = payload.get("id") or uuid.uuid4().hex
    session_id = payload.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id é obrigatório.")

    values = {
        "id": photo_id,
        "session_id": session_id,
        "scalp_area": payload.get("scalp_area") or "unknown",
        "photo_url": normalize_storage_url(payload.get("photo_url") or ""),
        "annotated_photo_url": normalize_storage_url(payload.get("annotated_photo_url")),
        "hair_mask_url": normalize_storage_url(payload.get("hair_mask_url")),
        "scalp_mask_url": normalize_storage_url(payload.get("scalp_mask_url")),
        "hair_count": payload.get("hair_count"),
        "strand_count": payload.get("strand_count"),
        "avg_thickness_px": payload.get("avg_thickness_px"),
        "hair_coverage_pct": payload.get("hair_coverage_pct"),
        "gray_threshold": payload.get("gray_threshold"),
        "created_at": utc_now(),
    }
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO session_photos (
                id, session_id, scalp_area, photo_url, annotated_photo_url,
                hair_mask_url, scalp_mask_url, hair_count, strand_count,
                avg_thickness_px, hair_coverage_pct, gray_threshold, created_at
            )
            VALUES (
                :id, :session_id, :scalp_area, :photo_url, :annotated_photo_url,
                :hair_mask_url, :scalp_mask_url, :hair_count, :strand_count,
                :avg_thickness_px, :hair_coverage_pct, :gray_threshold, :created_at
            )
            """,
            values,
        )
        recalculate_session_metrics(conn, session_id)
    return values


def _save_rgb_to_storage(
    rgb_array: np.ndarray,
    folder_name: str,
    stem: str,
    kind: str,
) -> tuple[str, str]:
    """Salva uma imagem RGB como PNG no storage local e retorna (public_url, data_url)."""
    storage_prefix = "session-photos"
    target_dir = STORAGE_DIR / storage_prefix / folder_name
    target_dir.mkdir(parents=True, exist_ok=True)

    buf = io.BytesIO()
    Image.fromarray(rgb_array).save(buf, format="PNG", optimize=True)
    png_bytes = buf.getvalue()

    target = target_dir / f"{stem}_{kind}.png"
    target.write_bytes(png_bytes)

    relative_path = target.relative_to(STORAGE_DIR)
    public_url = build_public_url(storage_prefix, str(relative_path))
    data_url = f"data:image/png;base64,{base64.b64encode(png_bytes).decode('utf-8')}"
    return public_url, data_url


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/patients")
def get_patients() -> list[dict[str, Any]]:
    return list_patients()


@app.post("/api/patients")
async def create_patient_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    return create_patient(payload)


@app.patch("/api/patients/{patient_id}")
async def update_patient_endpoint(patient_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return update_patient(patient_id, payload)


@app.get("/api/sessions")
def get_sessions(patient_id: str | None = None, id: str | None = None) -> list[dict[str, Any]]:
    if id:
        with get_db_connection() as conn:
            rows = conn.execute("SELECT * FROM sessions WHERE id = ?", (id,)).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            session = dict(row)
            session["session_photos"] = list_session_photos(session["id"])
            result.append(session)
        return result
    if patient_id:
        return list_sessions_for_patient(patient_id)
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM sessions ORDER BY session_date ASC").fetchall()
    result = []
    for row in rows:
        session = dict(row)
        session["session_photos"] = list_session_photos(session["id"])
        result.append(session)
    return result


@app.post("/api/sessions")
async def create_session_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    return create_session(payload)


@app.patch("/api/sessions")
async def update_session_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    session_id = payload.get("id")
    if not session_id:
        raise HTTPException(status_code=400, detail="A sessão precisa de um id.")

    allowed = ("session_date", "total_hairs", "avg_strands", "avg_thickness_px", "avg_coverage_pct", "notes")
    updates = {key: payload[key] for key in allowed if key in payload}
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")

    assignments = ", ".join(f"{key} = ?" for key in updates)
    with get_db_connection() as conn:
        cursor = conn.execute(
            f"UPDATE sessions SET {assignments} WHERE id = ?",
            (*updates.values(), session_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()

    session = dict(row)
    session["session_photos"] = list_session_photos(session_id)
    return session


@app.delete("/api/sessions/{session_id}")
def delete_session_endpoint(session_id: str) -> dict[str, Any]:
    with get_db_connection() as conn:
        cursor = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    return {"deleted": True, "id": session_id}


@app.post("/api/session_photos")
async def create_session_photo_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    return create_session_photo(payload)


@app.get("/api/session_photos")
def get_session_photos(session_id: str) -> list[dict[str, Any]]:
    return list_session_photos(session_id)


@app.delete("/api/session_photos/{photo_id}")
def delete_session_photo_endpoint(photo_id: str) -> dict[str, Any]:
    with get_db_connection() as conn:
        row = conn.execute("SELECT session_id FROM session_photos WHERE id = ?", (photo_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Foto não encontrada.")
        session_id = row["session_id"]
        conn.execute("DELETE FROM session_photos WHERE id = ?", (photo_id,))
        recalculate_session_metrics(conn, session_id)
    return {"deleted": True, "id": photo_id}


@app.post("/api/storage/upload")
async def upload_storage_file(
    file: UploadFile = File(...),
    bucket: str = Form(default="session-photos"),
) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Arquivo inexistente.")

    target_dir = STORAGE_DIR / bucket
    target_dir.mkdir(parents=True, exist_ok=True)
    safe_name = file.filename.replace("\\", "/").lstrip("/")
    target_path = target_dir / safe_name
    target_path.parent.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    target_path.write_bytes(content)

    url = build_public_url(bucket, str(target_path.relative_to(STORAGE_DIR)))
    return {"path": str(target_path.relative_to(STORAGE_DIR)), "url": url}


@app.post("/api/analyze")
async def analyze_image(
    file: UploadFile = File(...),
    session_id: str | None = Form(default=None),
    scalp_area: str = Form(default="frontal"),
    patient_id: str | None = Form(default=None),
    hair_gray_max: int | None = Form(default=None),
) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Arquivo inexistente.")

    if not file.filename.lower().endswith(ALLOWED_EXTENSIONS):
        raise HTTPException(status_code=400, detail="Formato de imagem não suportado.")

    file_bytes = await file.read()
    np_buffer = np.frombuffer(file_bytes, dtype=np.uint8)
    image_bgr = cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise HTTPException(status_code=400, detail="Não foi possível decodificar a imagem enviada.")

    try:
        # 1. Segmentação de fios e couro cabeludo (bitwise_not) em escala de cinza
        seg = segment_hairs_grayscale(image_bgr, hair_gray_max=hair_gray_max)

        # 2. Detecção de bulbos / unidades foliculares via costura de fios + tracking até o couro cabeludo
        origin_conf = float(os.getenv("BULB_ORIGIN_CONFIDENCE", "0.72"))
        detections, origin_debug = detect_bulbs_from_hair_origins(
            image_bgr,
            hair_mask=seg.hair_mask,
            scalp_mask=seg.scalp_mask,
            scalp_gray_median=seg.scalp_gray_median,
            min_confidence=origin_conf,
            return_debug=True,
        )

        # 3. Renderização das visualizações separadas e combinada em RGB
        folder_name = session_id or "anonymous"
        stem = uuid.uuid4().hex

        original_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        original_photo_url, _ = _save_rgb_to_storage(original_rgb, folder_name, stem, "original")

        combined_rgb = render_combined_overlay(
            image_bgr,
            seg.hair_mask,
            detections,
            open_scalp=origin_debug["open_scalp"],
        )
        annotated_photo_url, annotated_data_url = _save_rgb_to_storage(combined_rgb, folder_name, stem, "annotated")

        hair_mask_rgb = render_hair_mask_visual(seg.hair_mask)
        hair_mask_url, hair_mask_data_url = _save_rgb_to_storage(hair_mask_rgb, folder_name, stem, "hair_mask")

        scalp_mask_rgb = render_scalp_mask_visual(image_bgr, seg.scalp_mask)
        scalp_mask_url, scalp_mask_data_url = _save_rgb_to_storage(scalp_mask_rgb, folder_name, stem, "scalp_mask")

        return {
            "count": len(detections),
            "bulb_count": len(detections),
            "detections": detections,
            "strand_count": seg.strand_count,
            "avg_thickness_px": seg.avg_thickness_px,
            "median_thickness_px": seg.median_thickness_px,
            "hair_coverage_pct": seg.hair_coverage_pct,
            "gray_threshold": seg.gray_threshold,
            "scalp_gray_median": seg.scalp_gray_median,
            "hair_gray_median": seg.hair_gray_median,
            "image_width": seg.image_width,
            "image_height": seg.image_height,
            "original_photo_url": original_photo_url,
            "annotated_photo_url": annotated_photo_url,
            "annotated_image_data_url": annotated_data_url,
            "hair_mask_url": hair_mask_url,
            "hair_mask_data_url": hair_mask_data_url,
            "scalp_mask_url": scalp_mask_url,
            "scalp_mask_data_url": scalp_mask_data_url,
            "session_id": session_id,
            "patient_id": patient_id,
            "scalp_area": scalp_area,
            "model_used": BULB_DETECTION_METHOD,
            "stitched_links": origin_debug["stitched_links"],
        }
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Erro ao analisar imagem: {exc}") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("BACKEND_PORT", "8000")), reload=True)
