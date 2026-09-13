# Deploy com Docker

## Requisitos

- Docker Engine 24 ou superior
- Docker Compose v2

## Subir a aplicação

Na raiz do projeto:

```bash
docker compose up -d --build
```

A aplicação ficará disponível em `http://SEU_SERVIDOR` ou na porta definida por `APP_PORT`.

Exemplo usando outra porta:

```bash
APP_PORT=8080 docker compose up -d --build
```

O volume `backend-data` persiste o banco SQLite e as imagens enviadas. Para acompanhar os logs:

```bash
docker compose logs -f
```

Para parar:

```bash
docker compose down
```

Para atualizar depois de alterar o código:

```bash
docker compose up -d --build
```

## Variáveis opcionais

Crie um arquivo `.env` na raiz:

```env
APP_PORT=80
CORS_ORIGINS=http://localhost
YOLO_CONFIDENCE=0.25
YOLO_IMGSZ=640
```

Em produção, troque `CORS_ORIGINS` pelo domínio público usado para acessar a aplicação.

O frontend usa o Nginx como proxy interno: `/api` e `/storage` são encaminhados automaticamente ao backend. Por isso não é necessário expor a porta 8000 publicamente.
