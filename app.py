"""
AgriPrice Portal - Main Launcher
Run this file to start everything:
  python app.py
"""

import os
import sys
import time
import subprocess
import webbrowser
import signal

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PYTHON_MODEL_DIR = os.path.join(BASE_DIR, "python_model")

# ── Colors for terminal output ──
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
CYAN   = "\033[96m"
RESET  = "\033[0m"

def log(msg, color=GREEN):
    print(f"{color}{msg}{RESET}")

# ══════════════════════════════════════
# STEP 1: Install Python dependencies
# ══════════════════════════════════════
def install_python_deps():
    log("\n[1/4] Installing Python packages...", CYAN)
    packages = ["flask", "flask-cors", "pandas", "scikit-learn", "PyPDF2"]
    try:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install"] + packages + ["--quiet"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        log("      Python packages ready ✅")
    except Exception as e:
        log(f"      Warning: {e}", YELLOW)

# ══════════════════════════════════════
# STEP 2: Install Node.js dependencies
# ══════════════════════════════════════
def install_node_deps():
    log("\n[2/4] Installing Node.js packages...", CYAN)
    try:
        result = subprocess.run(
            "npm install",
            cwd=BASE_DIR,
            shell=True,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            log("      Node.js packages ready ✅")
        else:
            log(f"      npm install warning: {result.stderr[:100]}", YELLOW)
    except Exception as e:
        log(f"      Warning: {e}", YELLOW)

# ══════════════════════════════════════
# STEP 3: Start Python model server
# ══════════════════════════════════════
def start_python_model():
    log("\n[3/4] Starting Python soil model (port 5000)...", CYAN)
    try:
        py_process = subprocess.Popen(
            [sys.executable, "app.py"],
            cwd=PYTHON_MODEL_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        # Wait a moment and check it started
        time.sleep(3)
        if py_process.poll() is None:
            log("      Python model running on http://localhost:5000 ✅")
        else:
            out, err = py_process.communicate()
            log(f"      Python model error: {err[:200]}", RED)
        return py_process
    except Exception as e:
        log(f"      Could not start Python model: {e}", RED)
        return None

# ══════════════════════════════════════
# STEP 4: Start Node.js server
# ══════════════════════════════════════
def start_node_server():
    log("\n[4/4] Starting Node.js server (port 3000)...", CYAN)
    try:
        node_process = subprocess.Popen(
            "node server.js",
            cwd=BASE_DIR,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        # Wait for server to start
        time.sleep(4)
        if node_process.poll() is None:
            log("      Node.js server running on http://localhost:3000 ✅")
        else:
            out, err = node_process.communicate()
            log(f"      Node.js error: {err[:200]}", RED)
        return node_process
    except Exception as e:
        log(f"      Could not start Node.js: {e}", RED)
        return None

# ══════════════════════════════════════
# MAIN
# ══════════════════════════════════════
def main():
    print(f"""
{GREEN}╔══════════════════════════════════════════╗
║        AgriPrice Portal Launcher         ║
║   Starting all services automatically    ║
╚══════════════════════════════════════════╝{RESET}
""")
    log("⚠️  Make sure XAMPP MySQL is running!", YELLOW)
    print()

    # Install dependencies
    install_python_deps()
    install_node_deps()

    # Start services
    py_proc   = start_python_model()
    node_proc = start_node_server()

    if not node_proc:
        log("\n❌ Failed to start. Make sure Node.js is installed.", RED)
        input("Press Enter to exit...")
        sys.exit(1)

    # Open browser
    time.sleep(2)
    log("\n🌐 Opening browser at http://localhost:3000...", CYAN)
    webbrowser.open("http://localhost:3000")

    print(f"""
{GREEN}╔══════════════════════════════════════════╗
║         Everything is running! ✅         ║
╠══════════════════════════════════════════╣
║  Website  → http://localhost:3000         ║
║  Python   → http://localhost:5000         ║
║  Database → XAMPP MySQL (port 3306)       ║
╠══════════════════════════════════════════╣
║  Press Ctrl+C to stop all services        ║
╚══════════════════════════════════════════╝{RESET}
""")

    # Keep running and handle Ctrl+C
    def shutdown(sig, frame):
        log("\n\nStopping all services...", YELLOW)
        if py_proc:
            py_proc.terminate()
        if node_proc:
            node_proc.terminate()
        log("All services stopped. Goodbye! 👋", GREEN)
        sys.exit(0)

    signal.signal(signal.SIGINT,  shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Keep the script alive
    while True:
        time.sleep(1)
        # Restart Python model if it crashes
        if py_proc and py_proc.poll() is not None:
            log("  Python model stopped — restarting...", YELLOW)
            py_proc = start_python_model()

if __name__ == "__main__":
    main()
