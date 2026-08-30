import base64
import io
import os
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from supabase import create_client
from ultralytics import YOLO

load_dotenv()

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

MODEL: YOLO | None = None


def get_model() -> YOLO:
    global MODEL

    if MODEL is None:
        configured_model = os.getenv("YOLO_MODEL", "best.pt")
        candidate_paths = [
            Path(configured_model),
            Path(__file__).resolve().parent / "YOLO_MODEL" / "best.pt",
            Path(__file__).resolve().parent / "YOLO_MODEL" / configured_model,
            Path(__file__).resolve().parent / configured_model,
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


def store_image_in_supabase(image_path: Path, session_id: str | None, scalp_area: str | None, kind: str = "annotated") -> str | None:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        return None

    client = create_client(supabase_url, supabase_key)
    storage_prefix = "session-photos"
    object_name = f"{session_id or 'anonymous'}/{uuid.uuid4()}_{kind}.png"

    with image_path.open("rb") as image_file:
        client.storage.from_(storage_prefix).upload(
            object_name,
            image_file.read(),
            file_options={"content-type": "image/png"},
        )

    public_url = client.storage.from_(storage_prefix).get_public_url(object_name)

    if session_id:
        try:
            payload = {
                "session_id": session_id,
                "scalp_area": scalp_area or "unknown",
                "photo_url": public_url,
                "hair_count": 0,
            }
            if kind == "annotated":
                payload["annotated_photo_url"] = public_url
            client.table("session_photos").insert(payload).execute()
        except Exception:
            pass

    return public_url


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


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
        annotated_photo_url = store_image_in_supabase(output_path, session_id, scalp_area, kind="annotated")

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
