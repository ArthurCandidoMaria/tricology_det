@echo off
cd /d "%~dp0"
python -m venv .venv
call .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
if exist .env ( 
    echo .env found
) else (
    copy .env.example .env
)
uvicorn app:app --reload --host 0.0.0.0 --port 8000
