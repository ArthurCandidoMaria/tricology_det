"""
Testes automatizados de integração do backend (SQLite, segmentação grayscale,
detecção de bulbos via costura de fios + tracking até o couro cabeludo bitwise_not
e endpoints REST, sem dependência de YOLO). Usa banco e storage temporários isolados,
sem alterar os dados de produção.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

_TEMP_DIR = tempfile.TemporaryDirectory(prefix="follicletrack_test_")
os.environ["DB_PATH"] = str(Path(_TEMP_DIR.name) / "test.db")
os.environ["STORAGE_DIR"] = str(Path(_TEMP_DIR.name) / "storage")

import app as backend_app  # noqa: E402
from hair_segmentation import segment_hairs_grayscale  # noqa: E402


def _make_synthetic_trichoscopy(width: int = 480, height: int = 360) -> bytes:
    """Gera imagem sintética com couro cabeludo claro e 6 fios escuros de calibre conhecido."""
    img = np.full((height, width, 3), (185, 195, 215), dtype=np.uint8)
    # Adiciona textura suave de pele
    rng = np.random.default_rng(42)
    noise = rng.integers(-6, 7, size=img.shape, dtype=np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    # Desenha 6 fios escuros de 5px de espessura
    lines = [
        ((30, 40), (440, 60)),
        ((40, 110), (430, 130)),
        ((35, 180), (450, 190)),
        ((45, 250), (420, 270)),
        ((100, 20), (140, 340)),
        ((300, 20), (330, 340)),
    ]
    for p1, p2 in lines:
        cv2.line(img, p1, p2, (25, 28, 35), thickness=5, lineType=cv2.LINE_AA)

    ok, encoded = cv2.imencode(".png", img)
    assert ok
    return encoded.tobytes()


class BackendIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        backend_app.init_db()
        cls.client = TestClient(backend_app.app)

    def test_01_health(self) -> None:
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"status": "ok"})

    def test_02_grayscale_segmentation_metrics_synthetic(self) -> None:
        png_bytes = _make_synthetic_trichoscopy()
        img = cv2.imdecode(np.frombuffer(png_bytes, np.uint8), cv2.IMREAD_COLOR)
        seg = segment_hairs_grayscale(img)

        # Máscaras devem ser complementares (cabeça vs fios)
        self.assertEqual(seg.hair_mask.shape, seg.scalp_mask.shape)
        self.assertTrue(np.array_equal(seg.hair_mask ^ seg.scalp_mask, np.full_like(seg.hair_mask, 255)))

        # Deve detectar os fios desenhados (~6 fios) e espessura próxima a 5px
        self.assertGreaterEqual(seg.strand_count, 5)
        self.assertLessEqual(seg.strand_count, 8)
        self.assertGreaterEqual(seg.avg_thickness_px, 3.5)
        self.assertLessEqual(seg.avg_thickness_px, 7.0)
        self.assertGreater(seg.hair_coverage_pct, 1.0)
        self.assertGreater(seg.scalp_gray_median, seg.hair_gray_median)

    def test_03_patient_session_and_analyze_full_flow(self) -> None:
        # 1. Criar paciente
        p_res = self.client.post(
            "/api/patients",
            json={
                "name": "Paciente Validação",
                "date_of_birth": "1988-05-12",
                "cpf": "123.456.789-00",
                "phone": "(11) 98888-7777",
                "email": "paciente@clinica.com",
                "notes": "Alopecia androgenética inicial",
            },
        )
        self.assertEqual(p_res.status_code, 200)
        patient = p_res.json()
        patient_id = patient["id"]

        # 2. Editar anotações do paciente
        patch_res = self.client.patch(
            f"/api/patients/{patient_id}",
            json={"notes": "Protocolo Minoxidil 5% + MMP"},
        )
        self.assertEqual(patch_res.status_code, 200)
        self.assertEqual(patch_res.json()["notes"], "Protocolo Minoxidil 5% + MMP")

        # 3. Analisar imagem real (se disponível) ou sintética via /api/analyze
        real_sample = Path(
            r"c:\Users\arthu\OneDrive\Documents\frontend_hair\teste_images\WhatsApp Image 2026-11-25 at 22.19.47.jpeg"
        )
        if real_sample.exists():
            file_bytes = real_sample.read_bytes()
            file_name = real_sample.name
            mime = "image/jpeg"
        else:
            file_bytes = _make_synthetic_trichoscopy()
            file_name = "synthetic.png"
            mime = "image/png"

        an_res = self.client.post(
            "/api/analyze",
            files={"file": (file_name, file_bytes, mime)},
            data={"scalp_area": "frontal", "patient_id": patient_id},
        )
        self.assertEqual(an_res.status_code, 200, an_res.text)
        analysis = an_res.json()

        self.assertIn("bulb_count", analysis)
        self.assertEqual(analysis["model_used"], "hair-origin-tracking-v3")
        self.assertNotIn("ultralytics", sys.modules)
        if real_sample.exists():
            self.assertGreater(analysis["bulb_count"], 10)
            self.assertEqual(analysis["detections"][0]["class"], "bulbo")
        self.assertGreater(analysis["strand_count"], 0)
        self.assertGreater(analysis["avg_thickness_px"], 0)
        self.assertTrue(analysis["annotated_photo_url"].startswith("/storage/"))
        self.assertTrue(analysis["hair_mask_url"].startswith("/storage/"))
        self.assertTrue(analysis["scalp_mask_url"].startswith("/storage/"))
        self.assertTrue(analysis["original_photo_url"].startswith("/storage/"))

        # Verificar que todas as imagens geradas são servidas pelo StaticFiles /storage
        for key in ("original_photo_url", "annotated_photo_url", "hair_mask_url", "scalp_mask_url"):
            img_res = self.client.get(analysis[key])
            self.assertEqual(img_res.status_code, 200, f"Falha ao servir {key}: {analysis[key]}")
            self.assertGreater(len(img_res.content), 1000)

        # Testar override manual da janela grayscale
        manual_res = self.client.post(
            "/api/analyze",
            files={"file": (file_name, file_bytes, mime)},
            data={"scalp_area": "frontal", "hair_gray_max": "110"},
        )
        self.assertEqual(manual_res.status_code, 200)
        self.assertEqual(manual_res.json()["gray_threshold"], 110.0)

        # 4. Salvar sessão no SQLite com as novas colunas de fios, espessura e máscaras
        sess_res = self.client.post(
            "/api/sessions",
            json={
                "patient_id": patient_id,
                "session_date": "2026-11-25",
                "total_hairs": analysis["bulb_count"],
                "avg_strands": analysis["strand_count"],
                "avg_thickness_px": analysis["avg_thickness_px"],
                "avg_coverage_pct": analysis["hair_coverage_pct"],
                "notes": "Sessão validada",
                "photos": [
                    {
                        "scalp_area": "frontal",
                        "photo_url": analysis["original_photo_url"],
                        "annotated_photo_url": analysis["annotated_photo_url"],
                        "hair_mask_url": analysis["hair_mask_url"],
                        "scalp_mask_url": analysis["scalp_mask_url"],
                        "hair_count": analysis["bulb_count"],
                        "strand_count": analysis["strand_count"],
                        "avg_thickness_px": analysis["avg_thickness_px"],
                        "hair_coverage_pct": analysis["hair_coverage_pct"],
                        "gray_threshold": analysis["gray_threshold"],
                    }
                ],
            },
        )
        self.assertEqual(sess_res.status_code, 200, sess_res.text)
        session = sess_res.json()
        self.assertEqual(session["avg_strands"], float(analysis["strand_count"]))
        self.assertAlmostEqual(session["avg_thickness_px"], analysis["avg_thickness_px"], places=2)
        self.assertEqual(len(session["session_photos"]), 1)

        photo_saved = session["session_photos"][0]
        self.assertEqual(photo_saved["strand_count"], analysis["strand_count"])
        self.assertAlmostEqual(photo_saved["avg_thickness_px"], analysis["avg_thickness_px"], places=2)
        self.assertEqual(photo_saved["hair_mask_url"], analysis["hair_mask_url"])
        self.assertEqual(photo_saved["scalp_mask_url"], analysis["scalp_mask_url"])

        # 5. Consultar sessões do paciente e confirmar persistência
        list_res = self.client.get(f"/api/sessions?patient_id={patient_id}")
        self.assertEqual(list_res.status_code, 200)
        sessions = list_res.json()
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["session_photos"][0]["strand_count"], analysis["strand_count"])

        # 6. Excluir sessão e verificar cascata
        del_res = self.client.delete(f"/api/sessions/{session['id']}")
        self.assertEqual(del_res.status_code, 200)
        self.assertEqual(self.client.get(f"/api/sessions?patient_id={patient_id}").json(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
