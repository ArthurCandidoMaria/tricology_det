# Backend de análise tricoscópica (Visão Computacional — Sem Rede Neural)

Este serviço expõe uma API em FastAPI para receber imagens tricoscópicas do frontend, segmentar fios e couro cabeludo em escala de cinza (`bitwise_not`), reconstruir os fios via `connectedComponentsWithStats`, rastrear cada fio até a entrada na cabeça para detectar e contar os bulbos, e devolver as máscaras e a imagem anotada para exibição.

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

- `GET /health`
- `POST /api/analyze`
- `GET/POST/PATCH /api/patients`
- `GET/POST/PATCH/DELETE /api/sessions`
- `GET/POST/DELETE /api/session_photos`

### Upload (`/api/analyze`)

FormData esperado:
- `file`: imagem
- `session_id`: opcional
- `scalp_area`: opcional
- `patient_id`: opcional
- `hair_gray_max`: opcional (override manual da janela grayscale `0..255`)

### Resposta esperada

```json
{
  "count": 24,
  "bulb_count": 24,
  "strand_count": 128,
  "avg_thickness_px": 4.2,
  "hair_coverage_pct": 27.5,
  "model_used": "hair-origin-tracking-v2",
  "detections": [
    {
      "class": "bulbo",
      "confidence": 0.91,
      "bbox": [110.0, 82.0, 132.0, 104.0],
      "center": [121.0, 93.0]
    }
  ],
  "annotated_image_data_url": "data:image/png;base64,..."
}
```

> Não requer PyTorch, GPU ou pesos YOLO: todo o processamento roda em CPU com OpenCV, NumPy e scikit-image.
