# Backend de análise de cabelo com YOLO

Este serviço expõe uma API em FastAPI para receber imagens do frontend, detectar objetos com YOLO e devolver uma imagem anotada para exibição.

## Como iniciar

1. Crie o ambiente virtual:
   python -m venv .venv
   .\.venv\Scripts\activate

2. Instale as dependências:
   pip install -r requirements.txt

3. Configure as variáveis de ambiente:
   copy .env.example .env

4. Inicie o servidor:
   uvicorn app:app --reload --host 0.0.0.0 --port 8000

## Endpoints

- GET /health
- POST /api/analyze

### Upload

FormData esperado:
- file: imagem
- session_id: opcional
- scalp_area: opcional
- patient_id: opcional

### Resposta esperada

{
  "count": 3,
  "detections": [
    {"class": "hair", "confidence": 0.91, "bbox": [x1, y1, x2, y2]}
  ],
  "annotated_image_data_url": "data:image/png;base64,...",
  "storage_url": "https://..."
}

> Utiliza o modelo `yolov8n.pt` por padrão. Se o modelo não estiver disponível localmente, o Ultralytics fará o download automaticamente.
