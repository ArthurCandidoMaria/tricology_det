from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"


def get_python_executable() -> str:
    venv_python = BACKEND_DIR / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if venv_python.exists():
        return str(venv_python)
    return sys.executable


def get_npm_command() -> list[str]:
    if os.name == "nt":
        return ["npm.cmd"]
    return ["npm"]


def start_process(command: list[str], cwd: Path, label: str) -> subprocess.Popen:
    print(f"\n[{label}] Iniciando: {' '.join(command)}")
    return subprocess.Popen(command, cwd=str(cwd), stdin=subprocess.DEVNULL)


def main() -> int:
    parser = argparse.ArgumentParser(description="Inicia o frontend Vite e o backend FastAPI juntos.")
    parser.add_argument("--frontend-port", type=int, default=int(os.getenv("FRONTEND_PORT", "5173")))
    parser.add_argument("--backend-port", type=int, default=int(os.getenv("BACKEND_PORT", "8008")))
    args = parser.parse_args()

    backend_script = BACKEND_DIR / "app.py"
    if not backend_script.exists():
        print("Arquivo backend/app.py não encontrado.")
        return 1

    package_json = ROOT / "package.json"
    if not package_json.exists():
        print("Arquivo package.json não encontrado na raiz do projeto.")
        return 1

    python_bin = get_python_executable()
    npm_cmd = get_npm_command()

    processes: list[subprocess.Popen] = []

    try:
        backend_cmd = [
            python_bin,
            "-m",
            "uvicorn",
            "app:app",
            "--host",
            "0.0.0.0",
            "--port",
            str(args.backend_port),
        ]
        frontend_cmd = [
            *npm_cmd,
            "run",
            "dev",
            "--",
            "--host",
            "0.0.0.0",
            "--port",
            str(args.frontend_port),
        ]

        processes.append(start_process(backend_cmd, BACKEND_DIR, "BACKEND"))
        processes.append(start_process(frontend_cmd, ROOT, "FRONTEND"))

        print("\nAplicação rodando.")
        print(f"Frontend: http://localhost:{args.frontend_port}")
        print(f"Backend: http://localhost:{args.backend_port}")
        print("Pressione Ctrl+C para encerrar todos os processos.\n")

        while True:
            if any(p.poll() is not None for p in processes):
                failed = next((p for p in processes if p.poll() is not None), None)
                if failed is not None:
                    returncode = failed.wait()
                    print(f"\nProcesso falhou com código {returncode}.")
                    break
            time.sleep(1)

    except KeyboardInterrupt:
        print("\nEncerrando serviços...")
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
        print("Serviços encerrados.")
        return 0

    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
