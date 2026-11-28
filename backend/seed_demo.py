"""
Popula o banco local com um histórico de acompanhamento para demonstração das telas,
incluindo contagem de bulbos, quantidade de fios detectados e espessura média em pixels.

As sessões criadas aqui recebem ids com o prefixo "demo-", o que permite
removê-las sem tocar nos dados reais:

    python seed_demo.py --reset     # remove apenas o que este script criou
    python seed_demo.py             # remove e recria
"""

from __future__ import annotations

import argparse
import os
import random
import sqlite3
import uuid
from pathlib import Path

from app import init_db

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "hair_analysis.db")))
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", str(BASE_DIR / "storage")))
PHOTO_DIR = STORAGE_DIR / "session-photos" / "anonymous"

DEMO_PREFIX = "demo-"
PATIENT_NAME = "Teste 1"

# Curvas por região: (bulbos_ini, bulbos_fim, fios_ini, fios_fim, espessura_px_ini, espessura_px_fim)
AREA_CURVES: dict[str, tuple[int, int, int, int, float, float]] = {
    "frontal": (11, 21, 42, 74, 3.6, 4.7),           # resposta forte ao tratamento
    "vertex": (10, 15, 38, 56, 3.5, 4.3),            # resposta moderada
    "crown": (17, 14, 58, 49, 4.2, 3.9),             # leve perda
    "temporal-left": (12, 13, 45, 48, 3.9, 4.0),     # estável
    "temporal-right": (11, 11, 44, 45, 3.8, 3.9),    # estável
    "parietal-left": (12, 16, 47, 60, 4.0, 4.4),     # melhora leve
    "occipital-donor": (19, 19, 72, 73, 4.8, 4.8),   # área doadora: referência estável
}

SESSION_DATES = [
    "2026-03-07",
    "2026-04-11",
    "2026-05-16",
    "2026-06-13",
    "2026-07-18",
    "2026-08-15",
    "2026-09-16",
]

WIDE_SPREAD = ("2026-06-13", "vertex")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def available_photos() -> list[str]:
    if not PHOTO_DIR.is_dir():
        return []
    files = sorted(
        p for p in PHOTO_DIR.glob("*_annotated.png")
        if p.stat().st_size > 1024
    )
    if not files:
        files = sorted(p for p in PHOTO_DIR.glob("*.png") if p.stat().st_size > 1024)
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
        bulbs_in_session: list[int] = []
        strands_in_session: list[int] = []
        thickness_in_session: list[float] = []
        coverage_in_session: list[float] = []
        rows: list[tuple] = []

        for area, (b0, b1, s0, s1, t0, t1) in AREA_CURVES.items():
            progress = index / steps if steps else 1.0
            target_b = b0 + (b1 - b0) * progress
            target_s = s0 + (s1 - s0) * progress
            target_t = t0 + (t1 - t0) * progress

            wide = (session_date, area) == WIDE_SPREAD
            shots = rng.choice([2, 3]) if not wide else 4

            for _ in range(shots):
                jitter_b = rng.uniform(-4.5, 4.5) if wide else rng.uniform(-1.4, 1.4)
                bulbs = max(1, round(target_b + jitter_b))
                strands = max(5, round(target_s + rng.uniform(-4.0, 4.0)))
                thickness = round(max(1.8, target_t + rng.uniform(-0.25, 0.25)), 2)
                coverage = round(min(45.0, max(4.0, strands * thickness * 0.065)), 1)

                url = photos[photo_cursor % len(photos)]
                photo_cursor += 1
                bulbs_in_session.append(bulbs)
                strands_in_session.append(strands)
                thickness_in_session.append(thickness)
                coverage_in_session.append(coverage)

                rows.append(
                    (
                        uuid.uuid4().hex,
                        session_id,
                        area,
                        url,
                        url,
                        None,
                        None,
                        float(bulbs),
                        int(strands),
                        thickness,
                        coverage,
                        128.0,
                        created_at,
                    )
                )

        avg_bulbs = round(sum(bulbs_in_session) / len(bulbs_in_session))
        avg_strands = round(sum(strands_in_session) / len(strands_in_session), 1)
        avg_thickness = round(sum(thickness_in_session) / len(thickness_in_session), 2)
        avg_coverage = round(sum(coverage_in_session) / len(coverage_in_session), 1)

        conn.execute(
            """
            INSERT INTO sessions (
                id, patient_id, session_date, total_hairs,
                avg_strands, avg_thickness_px, avg_coverage_pct, notes, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                patient["id"],
                session_date,
                float(avg_bulbs),
                avg_strands,
                avg_thickness,
                avg_coverage,
                None,
                created_at,
            ),
        )
        conn.executemany(
            """
            INSERT INTO session_photos (
                id, session_id, scalp_area, photo_url, annotated_photo_url,
                hair_mask_url, scalp_mask_url, hair_count, strand_count,
                avg_thickness_px, hair_coverage_pct, gray_threshold, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        sessions_created += 1
        photos_created += len(rows)
        print(
            f"  {session_date}  bulbos={avg_bulbs:>3}  fios={avg_strands:>5}  "
            f"espessura={avg_thickness:>4.2f}px  fotos={len(rows)}"
        )

    return sessions_created, photos_created


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="Apenas remove as sessões de demonstração.")
    parser.add_argument("--seed", type=int, default=20260916, help="Semente do gerador, para dados reproduzíveis.")
    args = parser.parse_args()

    init_db()
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
