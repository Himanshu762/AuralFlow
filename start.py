import subprocess
import signal
import sys
import os
import time
import threading
import argparse

# Colors for log prefixes
class Colors:
    MONO = '\033[96m'  # Cyan
    API = '\033[92m'   # Green
    WEB = '\033[95m'   # Magenta
    SYS = '\033[93m'   # Yellow
    RESET = '\033[0m'

processes = []

def print_sys(msg):
    print(f"{Colors.SYS}[SYSTEM]{Colors.RESET} {msg}")

def stream_output(pipe, prefix, color):
    for line in iter(pipe.readline, ''):
        print(f"{color}{prefix}{Colors.RESET} {line.strip()}")

def start_process(name, cmd, cwd, prefix, color):
    try:
        process = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True,
            shell=False
        )
        processes.append((name, process))
        
        thread = threading.Thread(
            target=stream_output,
            args=(process.stdout, prefix, color),
            daemon=True
        )
        thread.start()
        print_sys(f"Started {name} (PID: {process.pid})")
        return process
    except Exception as e:
        print_sys(f"Failed to start {name}: {e}")
        sys.exit(1)

def cleanup(signum, frame):
    print_sys("\nShutting down services...")
    for name, process in reversed(processes):
        print_sys(f"Terminating {name}...")
        try:
            # Terminate gracefully
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        except Exception as e:
            pass
    print_sys("Shutdown complete.")
    sys.exit(0)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='AuralFlow Unified Launcher')
    parser.add_argument('--app', action='store_true', help='Launch Tauri desktop app')
    args = parser.parse_args()

    # Register cleanup handlers
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    root_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 1. Start Monochrome Dev Server
    mono_dir = os.path.join(root_dir, 'monochrome_app')
    start_process('Monochrome', ['npm', 'run', 'dev'], mono_dir, '[MONO]', Colors.MONO)
    
    # 2. Start FastAPI Backend
    backend_dir = os.path.join(root_dir, 'backend')
    # Using venv python
    python_bin = os.path.join(backend_dir, 'venv', 'bin', 'python')
    if not os.path.exists(python_bin):
        # Fallback to current python if venv not found
        python_bin = sys.executable
    start_process('Backend', [python_bin, '-m', 'uvicorn', 'app.main:app', '--reload', '--host', '0.0.0.0', '--port', '8000'], backend_dir, '[API ]', Colors.API)
    
    # 3. Start Next.js Frontend
    frontend_dir = os.path.join(root_dir, 'frontend')
    start_process('Frontend', ['npm', 'run', 'dev'], frontend_dir, '[WEB ]', Colors.WEB)

    print_sys(f"")
    print_sys(f"======================================")
    print_sys(f"AuralFlow Dev Environment Running")
    print_sys(f"======================================")
    print_sys(f"Monochrome : http://localhost:5173")
    print_sys(f"Backend    : http://localhost:8000")
    print_sys(f"Frontend   : http://localhost:3000")
    print_sys(f"Press Ctrl+C to stop all services")
    print_sys(f"")

    if args.app:
        # Start Tauri app
        time.sleep(2) # Give services a moment to start
        desktop_dir = os.path.join(root_dir, 'desktop')
        start_process('Tauri', ['npx', '@tauri-apps/cli', 'dev'], desktop_dir, '[APP ]', Colors.SYS)

    try:
        # Keep main thread alive
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        cleanup(None, None)
