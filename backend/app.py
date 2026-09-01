import base64
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
from ultralytics import YOLO

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "hair_analysis.db"
STORAGE_DIR = BASE_DIR / "storage"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Hair Analysis API", version="1.0.0")

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

MODEL: YOLO | None = None


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


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
                hair_count REAL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
            """
        )


init_db()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def list_patients() -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM patients ORDER BY created_at DESC").fetchall()
    return [dict(row) for row in rows]


def create_patient(payload: dict[str, Any]) -> dict[str, Any]:
    patient_id = payload.get("id") or uuid.uuid4().hex
    values = {
        "id": patient_id,
        "name": payload.get("name"),
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
    return values


def create_session(payload: dict[str, Any]) -> dict[str, Any]:
    session_id = payload.get("id") or uuid.uuid4().hex
    session_values = {
        "id": session_id,
        "patient_id": payload.get("patient_id"),
        "session_date": payload.get("session_date"),
        "total_hairs": payload.get("total_hairs"),
        "notes": payload.get("notes") or None,
        "created_at": utc_now(),
    }

    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO sessions (id, patient_id, session_date, total_hairs, notes, created_at)
            VALUES (:id, :patient_id, :session_date, :total_hairs, :notes, :created_at)
            """,
            session_values,
        )

        for photo in payload.get("photos") or []:
            photo_id = uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO session_photos (id, session_id, scalp_area, photo_url, annotated_photo_url, hair_count, created_at)
                VALUES (:id, :session_id, :scalp_area, :photo_url, :annotated_photo_url, :hair_count, :created_at)
                """,
                {
                    "id": photo_id,
                    "session_id": session_id,
                    "scalp_area": photo.get("scalp_area") or "unknown",
                    "photo_url": photo.get("photo_url") or "",
                    "annotated_photo_url": photo.get("annotated_photo_url"),
                    "hair_count": photo.get("hair_count"),
                    "created_at": utc_now(),
                },
            )

    return {**session_values, "session_photos": list_session_photos(session_id)}


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
        result.append(photo)
    return result


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
    values = {
        "id": photo_id,
        "session_id": payload.get("session_id"),
        "scalp_area": payload.get("scalp_area") or "unknown",
        "photo_url": normalize_storage_url(payload.get("photo_url") or ""),
        "annotated_photo_url": normalize_storage_url(payload.get("annotated_photo_url")),
        "hair_count": payload.get("hair_count"),
        "created_at": utc_now(),
    }
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO session_photos (id, session_id, scalp_area, photo_url, annotated_photo_url, hair_count, created_at)
            VALUES (:id, :session_id, :scalp_area, :photo_url, :annotated_photo_url, :hair_count, :created_at)
            """,
            values,
        )
    return values


def get_model() -> YOLO:
    global MODEL

    if MODEL is None:
        configured_model = os.getenv("YOLO_MODEL", "best_1.pt")
        candidate_paths = [
            Path(configured_model),
            BASE_DIR / "YOLO_MODEL" / "best_1.pt",
            BASE_DIR / "YOLO_MODEL" / configured_model,
            BASE_DIR / configured_model,
        ]

        chosen_model = None
        for candidate in candidate_paths:
            if candidate.exists():
                chosen_model = candidate
                break

        if chosen_model is None:
            chosen_model = configured_model

        print(f"Carregando modelo YOLO: {chosen_model}")
        MODEL = YOLO(str(chosen_model))

    return MODEL


def build_detections(result: Any) -> list[dict[str, Any]]:
    if result.boxes is None or len(result.boxes) == 0:
        return []

    labels = getattr(result, "names", {}) or {}
    detections: list[dict[str, Any]] = []

    for box in result.boxes:
        x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
        cls_id = int(box.cls[0].item())
        conf = float(box.conf[0].item())
        label = labels.get(cls_id, str(cls_id))

        detections.append(
            {
                "class": label,
                "confidence": round(conf, 4),
                "bbox": [x1, y1, x2, y2],
            }
        )

    return detections


def save_image_bytes(file_bytes: bytes, file_name: str) -> Path:
    base_dir = Path("tmp")
    base_dir.mkdir(exist_ok=True)
    target = base_dir / file_name
    target.write_bytes(file_bytes)
    return target


def encode_image_to_base64(image_path: Path) -> str:
    with image_path.open("rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


def normalize_storage_url(url: str | None) -> str | None:
    if not url:
        return url

    normalized = url.replace("\\", "/")
    normalized = normalized.replace("/storage/session-photos/session-photos/", "/storage/session-photos/")
    normalized = normalized.replace("/storage/session-photos//", "/storage/session-photos/")
    return normalized


def build_public_url(bucket: str, object_name: str) -> str:
    base_url = os.getenv("API_BASE_URL", "http://localhost:8000").rstrip("/")
    normalized = object_name.replace("\\", "/").lstrip("/")
    encoded_parts = "/".join(part for part in normalized.split("/") if part)

    if not encoded_parts:
        return f"{base_url}/storage/{bucket}"

    cleaned = encoded_parts.replace(f"{bucket}/{bucket}/", f"{bucket}/")
    if cleaned.startswith(f"{bucket}/"):
        return f"{base_url}/storage/{cleaned}"

    return f"{base_url}/storage/{cleaned}"


def store_image_in_local(image_path: Path, session_id: str | None, scalp_area: str | None, kind: str = "annotated") -> str | None:
    storage_prefix = "session-photos"
    folder_name = session_id or "anonymous"
    target_dir = STORAGE_DIR / storage_prefix / folder_name
    target_dir.mkdir(parents=True, exist_ok=True)

    target = target_dir / f"{uuid.uuid4()}_{kind}.png"
    target.write_bytes(image_path.read_bytes())

    relative_path = target.relative_to(STORAGE_DIR)
    public_url = build_public_url(storage_prefix, str(relative_path))

    if session_id:
        try:
            create_session_photo(
                {
                    "session_id": session_id,
                    "scalp_area": scalp_area or "unknown",
                    "photo_url": public_url,
                    "annotated_photo_url": public_url if kind == "annotated" else None,
                    "hair_count": 0,
                }
            )
        except Exception:
            pass

    return public_url


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/patients")
def get_patients() -> list[dict[str, Any]]:
    return list_patients()


@app.post("/api/patients")
async def create_patient_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    return create_patient(payload)


@app.get("/api/sessions")
def get_sessions(patient_id: str | None = None) -> list[dict[str, Any]]:
    if patient_id:
        return list_sessions_for_patient(patient_id)
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM sessions ORDER BY session_date ASC").fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        session = dict(row)
        session["session_photos"] = list_session_photos(session["id"])
        result.append(session)
    return result


@app.post("/api/sessions")
async def create_session_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    return create_session(payload)


@app.post("/api/session_photos")
async def create_session_photo_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    return create_session_photo(payload)


@app.post("/api/storage/upload")
async def upload_storage_file(file: UploadFile = File(...), bucket: str = Form(default="session-photos")) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Arquivo inexistente.")

    target_dir = STORAGE_DIR / bucket
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / file.filename
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
) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Arquivo inexistente.")

    allowed_extensions = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
    if not file.filename.lower().endswith(allowed_extensions):
        raise HTTPException(status_code=400, detail="Formato de imagem não suportado.")

    file_bytes = await file.read()
    temp_file = save_image_bytes(file_bytes, f"{uuid.uuid4()}_{file.filename}")

    try:
        model = get_model()
        results = model(str(temp_file), conf=float(os.getenv("YOLO_CONFIDENCE", "0.25")), imgsz=int(os.getenv("YOLO_IMGSZ", "640")), verbose=False)
        result = results[0]
        annotated = result.plot()

        annotated_image = Image.fromarray(annotated)
        output_path = temp_file.with_suffix(".annotated.png")
        annotated_image.save(output_path, format="PNG")

        detections = build_detections(result)
        base64_image = encode_image_to_base64(output_path)
        annotated_photo_url = store_image_in_local(output_path, session_id, scalp_area, kind="annotated")

        return {
            "count": len(detections),
            "detections": detections,
            "annotated_image_data_url": f"data:image/png;base64,{base64_image}",
            "annotated_photo_url": annotated_photo_url,
            "storage_url": annotated_photo_url,
            "session_id": session_id,
            "patient_id": patient_id,
            "scalp_area": scalp_area,
            "model_used": str(getattr(model, "ckpt_path", "best.pt")),
        }
    except Exception as exc:  # pragma: no cover - runtime issue surfaced to API callers
        raise HTTPException(status_code=500, detail=f"Erro ao analisar imagem: {exc}") from exc
    finally:
        for path in (temp_file, temp_file.with_suffix(".annotated.png")):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
