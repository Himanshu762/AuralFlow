#!/usr/bin/env python3
"""
AuralFlow launcher.

Starts the three local services the player needs and waits until each is
actually answering before reporting ready:

  Monochrome audio engine   Node    :5173
  Recommendation backend    Python  :8000
  Frontend (dev server)     Node    :3000

In normal use you do not run this — the Tauri app starts the engine and the
backend itself. This is the development entry point, and the fallback when
you want to run the UI in a browser.
"""

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))


class Colors:
    MONO = "\033[96m"
    API = "\033[92m"
    WEB = "\033[95m"
    APP = "\033[94m"
    SYS = "\033[93m"
    ERR = "\033[91m"
    RESET = "\033[0m"


processes: list[tuple[str, subprocess.Popen]] = []
_shutting_down = False


def log(msg: str) -> None:
    print(f"{Colors.SYS}[SYSTEM]{Colors.RESET} {msg}", flush=True)


def err(msg: str) -> None:
    print(f"{Colors.ERR}[ERROR ]{Colors.RESET} {msg}", flush=True)


# --------------------------------------------------------------------------
# Environment checks
# --------------------------------------------------------------------------


def port_open(port: int, host: str = "127.0.0.1") -> bool:
    """True when something already answers on the port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.25)
        return s.connect_ex((host, port)) == 0


def wait_for_port(port: int, timeout: float = 45.0) -> bool:
    """Block until the port answers, or the timeout expires."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_open(port):
            return True
        time.sleep(0.4)
    return False


def backend_python() -> str | None:
    """The backend's virtualenv interpreter, or the current one as a fallback."""
    candidates = [
        os.path.join(ROOT, "backend", "venv", "bin", "python"),
        os.path.join(ROOT, "backend", "venv", "Scripts", "python.exe"),
        os.path.join(ROOT, "backend", ".venv", "bin", "python"),
        os.path.join(ROOT, "backend", ".venv", "Scripts", "python.exe"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return sys.executable


def preflight(want_frontend: bool, want_app: bool) -> list[str]:
    """Return a list of problems that would stop services from starting."""
    problems: list[str] = []

    if shutil.which("npm") is None:
        problems.append(
            "npm was not found on PATH. Install Node.js 20+ from https://nodejs.org"
        )

    mono_dir = os.path.join(ROOT, "monochrome_app")
    if not os.path.exists(os.path.join(mono_dir, "package.json")):
        problems.append(
            f"monochrome_app/ is missing (looked in {mono_dir}). "
            "The audio engine lives there; clone or copy it before starting."
        )
    elif not os.path.isdir(os.path.join(mono_dir, "node_modules")):
        problems.append("monochrome_app dependencies are not installed. Run: cd monochrome_app && npm install")

    if not os.path.exists(os.path.join(ROOT, "backend", "app", "main.py")):
        problems.append("backend/app/main.py is missing — is this the AuralFlow checkout?")
    else:
        py = backend_python()
        probe = subprocess.run(
            [py, "-c", "import fastapi, uvicorn, torch"],
            capture_output=True,
            text=True,
        )
        if probe.returncode != 0:
            problems.append(
                "backend dependencies are not installed. Run:\n"
                "         python3 -m venv backend/venv\n"
                "         backend/venv/bin/pip install -r backend/requirements.txt"
            )

    if want_frontend and not os.path.isdir(os.path.join(ROOT, "frontend", "node_modules")):
        problems.append("frontend dependencies are not installed. Run: cd frontend && npm install")

    if want_app and not os.path.isdir(os.path.join(ROOT, "desktop", "node_modules")):
        problems.append("desktop dependencies are not installed. Run: cd desktop && npm install")

    return problems


# --------------------------------------------------------------------------
# Process management
# --------------------------------------------------------------------------


def stream_output(pipe, prefix: str, color: str) -> None:
    for line in iter(pipe.readline, ""):
        if _shutting_down:
            return
        print(f"{color}{prefix}{Colors.RESET} {line.rstrip()}", flush=True)


def start_process(name: str, cmd: list[str], cwd: str, prefix: str, color: str):
    try:
        process = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True,
        )
    except FileNotFoundError:
        err(f"Could not start {name}: {cmd[0]} not found on PATH")
        return None
    except Exception as e:  # noqa: BLE001 — surface anything that stops a service
        err(f"Could not start {name}: {e}")
        return None

    processes.append((name, process))
    threading.Thread(
        target=stream_output, args=(process.stdout, prefix, color), daemon=True
    ).start()
    log(f"Started {name} (pid {process.pid})")
    return process


def cleanup(signum=None, frame=None) -> None:
    global _shutting_down
    if _shutting_down:
        return
    _shutting_down = True

    print()
    log("Shutting down services…")
    for name, process in reversed(processes):
        if process.poll() is not None:
            continue
        log(f"Terminating {name}…")
        try:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        except Exception:  # noqa: BLE001 — best-effort shutdown
            pass
    log("Shutdown complete.")
    sys.exit(0)


# --------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="AuralFlow launcher")
    parser.add_argument(
        "--app", action="store_true", help="also launch the Tauri desktop app"
    )
    parser.add_argument(
        "--no-frontend",
        action="store_true",
        help="skip the Next.js dev server (the packaged app serves its own build)",
    )
    parser.add_argument(
        "--skip-checks", action="store_true", help="start services without preflight checks"
    )
    args = parser.parse_args()

    want_frontend = not args.no_frontend
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    if not args.skip_checks:
        problems = preflight(want_frontend, args.app)
        if problems:
            err("AuralFlow cannot start:")
            for p in problems:
                print(f"       • {p}", flush=True)
            print(
                f"\n       Re-run with --skip-checks to start anyway.\n",
                flush=True,
            )
            sys.exit(1)

    targets: list[tuple[str, int]] = []

    # 1. Monochrome audio engine
    if port_open(5173):
        log("Monochrome already running on :5173 — reusing it")
    else:
        if start_process(
            "Monochrome",
            ["npm", "run", "dev"],
            os.path.join(ROOT, "monochrome_app"),
            "[MONO]",
            Colors.MONO,
        ):
            targets.append(("Monochrome", 5173))

    # 2. Recommendation backend
    if port_open(8000):
        log("Backend already running on :8000 — reusing it")
    else:
        if start_process(
            "Backend",
            [
                backend_python(),
                "-m",
                "uvicorn",
                "app.main:app",
                "--reload",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            os.path.join(ROOT, "backend"),
            "[API ]",
            Colors.API,
        ):
            targets.append(("Backend", 8000))

    # 3. Frontend dev server
    if want_frontend:
        if port_open(3000):
            log("Frontend already running on :3000 — reusing it")
        else:
            if start_process(
                "Frontend",
                ["npm", "run", "dev"],
                os.path.join(ROOT, "frontend"),
                "[WEB ]",
                Colors.WEB,
            ):
                targets.append(("Frontend", 3000))

    # Health checks — report ready only once each service actually answers.
    for name, port in targets:
        if wait_for_port(port):
            log(f"{name} is healthy on :{port}")
        else:
            err(f"{name} did not come up on :{port} — check its log above")

    print()
    log("======================================")
    log("AuralFlow is running")
    log("======================================")
    log("Monochrome : http://localhost:5173")
    log("Backend    : http://localhost:8000  (docs at /docs)")
    if want_frontend:
        log("Frontend   : http://localhost:3000")
    log("Press Ctrl+C to stop everything")
    print()

    if args.app:
        start_process(
            "Tauri",
            ["npm", "run", "dev"],
            os.path.join(ROOT, "desktop"),
            "[APP ]",
            Colors.APP,
        )

    try:
        while True:
            for name, process in list(processes):
                if process.poll() is not None:
                    err(f"{name} exited with code {process.returncode}")
                    processes.remove((name, process))
            if not processes:
                err("All services stopped.")
                sys.exit(1)
            time.sleep(1)
    except KeyboardInterrupt:
        cleanup()


if __name__ == "__main__":
    main()
