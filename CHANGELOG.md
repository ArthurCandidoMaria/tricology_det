# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [Não Lançado] - Em Planejamento

### Planejado
- Detecção e segmentação de fios e bulbos capilares individuais via modelo YOLO Segmentation / Mask R-CNN.
- Módulo de cálculo de espessura de fios capilares (calibre em $\mu m$ com calibração métrica).
- Módulo de avaliação morfológica e escore de qualidade dos bulbos capilares.
- Visualizador interativo tricoscópico com camadas independentes (fios, bulbos, mapa de calor e medições).
- Geração de laudos clínicos comparativos em PDF.

---

## [0.2.0] - 2026-10-18

### Adicionado
- **Integração de Modelos YOLO:**
  - Script de treinamento `yolo_train.py` para detecção de unidades foliculares/cabelos.
  - Rotinas de anotação e conversão de anotações LabelMe para formato YOLO (`labelme_yolo.py`).
  - Pipeline de inferência preliminar com saída de imagens anotadas (`infer.py`, `infer_heat.py`).
  - Scripts de data augmentation para balanceamento de amostras tricoscópicas (`aug_ds.py`).
- **Arquitetura Fullstack Integrada:**
  - `server.py`: Inicializador unificado para rodar FastAPI e Vite/React simultaneamente.
  - Suporte a armazenamento local de arquivos em disco (`/storage/session-photos`) com endpoints para upload e listagem de fotos de sessão.
  - Endpoint `/api/analyze` atualizado para receber fotos e retornar contagem e imagem anotada gerada pelo modelo YOLO.

---

## [0.1.0] - 2026-08-30

### Adicionado
- **Frontend SPA (React + TypeScript + Tailwind CSS):**
  - Tela de Cadastro de Pacientes (`RegisterPatient.tsx`) com campos como CPF, data de nascimento, contato e notas.
  - Listagem e seleção de pacientes (`SelectPatient.tsx`, `Dashboard.tsx`).
  - Fluxo de Nova Sessão (`NewSession.tsx`) com upload de fotos por região do couro cabeludo (frontal, vértex, occipital, temporal).
  - Análise por área e por sessão (`AnalyzeByArea.tsx`, `AnalyzeBySession.tsx`, `SessionDashboard.tsx`).
  - Gráfico de evolução temporal com contagem e histórico de densidade capilar (`ProgressChart.tsx`).
- **Backend Base (FastAPI & SQLite / Supabase):**
  - API RESTful em FastAPI com banco SQLite local (`hair_analysis.db`).
  - Migrações SQL e suporte alternativo a Supabase (`20260828011029_create_hair_tracking_schema.sql`).
  - Entidades de Pacientes (`patients`), Sessões (`sessions`) e Fotos de Sessão (`session_photos`).
- **Containerização:**
  - Arquivos `docker-compose.yml`, `Dockerfile.frontend` e `Dockerfile.backend`.
