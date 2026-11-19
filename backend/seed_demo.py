"""
Popula o banco local com um histórico de acompanhamento para demonstração das telas.

As sessões criadas aqui recebem ids com o prefixo "demo-", o que permite
remove-las sem tocar nos dados reais:

    python seed_demo.py --reset     # remove apenas o que este script criou
    python seed_demo.py             # remove e recria

As contagens são sintéticas e NÃO correspondem ao que aparece nas imagens:
as fotos são reaproveitadas do storage existente apenas para que as telas
tenham conteúdo visual.
"""

from __future__ import annotations

import argparse
import os
import random
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "hair_analysis.db")))
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", str(BASE_DIR / "storage")))
PHOTO_DIR = STORAGE_DIR / "session-photos" / "anonymous"

DEMO_PREFIX = "demo-"
PATIENT_NAME = "Teste 1"

# Curva de cada região entre a primeira e a última sessão.
# O eixo longitudinal só fica legível se houver variação em direções diferentes:
# uma área que melhora, uma que cai e uma que serve de referência estável.
AREA_CURVES: dict[str, tuple[int, int]] = {
    "frontal": (11, 21),           # resposta forte ao tratamento
    "vertex": (10, 15),            # resposta moderada
    "crown": (17, 14),             # leve perda
    "temporal-left": (12, 13),     # estável
    "temporal-right": (11, 11),    # estável
    "parietal-left": (12, 16),     # melhora leve
    "occipital-donor": (19, 19),   # área doadora: referência, não deve variar
}

# Sessões mensais anteriores às duas já existentes, mais uma recente.
SESSION_DATES = [
    "2026-03-07",
    "2026-04-11",
    "2026-05-16",
    "2026-06-13",
    "2026-07-18",
    "2026-08-15",
    "2026-09-16",
]

# Uma sessão com enquadramento inconsistente, para exercitar o alerta de dispersão.
WIDE_SPREAD = ("2026-06-13", "vertex")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def available_photos() -> list[str]:
    """URLs relativas das imagens já presentes no storage, reaproveitadas ciclicamente."""
    if not PHOTO_DIR.is_dir():
        return []
    files = sorted(
        p for p in PHOTO_DIR.glob("*.png")
        if p.stat().st_size > 1024  # ignora placeholders como verify.png
    )
    return [f"/storage/session-photos/anonymous/{p.name}" for p in files]


def clear_demo(conn: sqlite3.Connection) -> int:
    cur = conn.execute("DELETE FROM sessions WHERE id LIKE ?", (f"{DEMO_PREFIX}%",))
    return cur.rowcount


def find_patient(conn: sqlite3.Connection) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM patients WHERE name = ?", (PATIENT_NAME,)).fetchone()
    if row is None:
        raise SystemExit(f"Paciente {PATIENT_NAME!r} não encontrado no banco.")
    return row


def seed(conn: sqlite3.Connection, rng: random.Random) -> tuple[int, int]:
    patient = find_patient(conn)
    photos = available_photos()
    if not photos:
        raise SystemExit(f"Nenhuma imagem encontrada em {PHOTO_DIR}.")

    steps = len(SESSION_DATES) - 1
    photo_cursor = 0
    sessions_created = 0
    photos_created = 0

    for index, session_date in enumerate(SESSION_DATES):
        session_id = f"{DEMO_PREFIX}{index:02d}-{uuid.uuid4().hex[:8]}"
        created_at = f"{session_date}T12:00:00Z"
        counts_in_session: list[int] = []
        rows: list[tuple] = []

        for area, (start, end) in AREA_CURVES.items():
            progress = index / steps if steps else 1.0
            target = start + (end - start) * progress

            wide = (session_date, area) == WIDE_SPREAD
            shots = rng.choice([2, 3]) if not wide else 4

            for _ in range(shots):
                jitter = rng.uniform(-4.5, 4.5) if wide else rng.uniform(-1.4, 1.4)
                count = max(1, round(target + jitter))
                url = photos[photo_cursor % len(photos)]
                photo_cursor += 1
                counts_in_session.append(count)
                rows.append(
                    (
                        uuid.uuid4().hex,
                        session_id,
                        area,
                        url,
                        url,
                        float(count),
                        created_at,
                    )
                )

        total = round(sum(counts_in_session) / len(counts_in_session))
        conn.execute(
            """
            INSERT INTO sessions (id, patient_id, session_date, total_hairs, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_id, patient["id"], session_date, float(total), None, created_at),
        )
        conn.executemany(
            """
            INSERT INTO session_photos
                (id, session_id, scalp_area, photo_url, annotated_photo_url, hair_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        sessions_created += 1
        photos_created += len(rows)
        print(f"  {session_date}  media={total:>3}  areas={len(AREA_CURVES)}  fotos={len(rows)}")

    return sessions_created, photos_created


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="Apenas remove as sessões de demonstração.")
    parser.add_argument("--seed", type=int, default=20260916, help="Semente do gerador, para dados reproduzíveis.")
    args = parser.parse_args()

    if not DB_PATH.exists():
        raise SystemExit(f"Banco não encontrado em {DB_PATH}.")

    conn = connect()
    try:
        removed = clear_demo(conn)
        if removed:
            print(f"Sessões de demonstração removidas: {removed}")

        if args.reset:
            conn.commit()
            print("Nada mais a fazer (--reset).")
            return 0

        print("Criando histórico de demonstração:")
        sessions, photos = seed(conn, random.Random(args.seed))
        conn.commit()
        print(f"\n{sessions} sessões e {photos} imagens criadas para {PATIENT_NAME!r}.")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
