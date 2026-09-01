from app import create_patient, create_session, init_db, list_patients, list_sessions_for_patient


def test_sqlite_database_initialization_and_crud():
    init_db()

    patient = create_patient({
        "name": "Maria Silva",
        "date_of_birth": "1990-01-01",
        "cpf": "12345678900",
        "phone": "(11) 99999-0000",
        "email": "maria@email.com",
        "notes": "Observação inicial",
    })

    assert patient["name"] == "Maria Silva"
    assert len(list_patients()) == 1

    session = create_session({
        "patient_id": patient["id"],
        "session_date": "2026-08-31",
        "total_hairs": 123,
        "notes": "Sessão inicial",
        "photos": [
            {
                "scalp_area": "frontal",
                "photo_url": "/storage/test-1.png",
                "annotated_photo_url": "/storage/test-1-annotated.png",
                "hair_count": 44,
            }
        ],
    })

    assert session["patient_id"] == patient["id"]
    assert len(session["session_photos"]) == 1
    assert session["session_photos"][0]["scalp_area"] == "frontal"

    sessions = list_sessions_for_patient(patient["id"])
    assert len(sessions) == 1
    assert sessions[0]["session_photos"][0]["hair_count"] == 44
