#!/usr/bin/env bash
#
# Install AuralFlow for the current user.
#
# Puts the built binary on PATH and registers a desktop entry so the app opens
# from the application launcher like any other program — no terminal, no
# services to start by hand.
#
# Usage:  ./desktop/install-local.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_SRC="$ROOT/desktop/src-tauri/target/release/auralflow-desktop"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor"

if [[ ! -x "$BIN_SRC" ]]; then
  echo "AuralFlow has not been built yet."
  echo "Run:  cd desktop && npm run build"
  exit 1
fi

mkdir -p "$BIN_DIR" "$APP_DIR"

# A launcher wrapper: the app finds the audio engine in its bundled resources,
# but the optional recommendation backend lives in this checkout.
cat > "$BIN_DIR/auralflow" <<LAUNCHER
#!/usr/bin/env bash
export AURALFLOW_ROOT="$ROOT"
exec "$BIN_SRC" "\$@"
LAUNCHER
chmod +x "$BIN_DIR/auralflow"

for size in 16 32 48 64 128 256 512; do
  src="$ROOT/desktop/src-tauri/icons/${size}x${size}.png"
  [[ -f "$src" ]] || continue
  dest="$ICON_DIR/${size}x${size}/apps"
  mkdir -p "$dest"
  cp "$src" "$dest/auralflow.png"
done

cat > "$APP_DIR/auralflow.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=AuralFlow
GenericName=Music Player
Comment=Lossless music player with a learning DJ
Exec=$BIN_DIR/auralflow
Icon=auralflow
Terminal=false
Categories=AudioVideo;Audio;Player;Music;
Keywords=music;audio;player;lossless;flac;
StartupWMClass=auralflow-desktop
SingleMainWindow=true
DESKTOP

update-desktop-database "$APP_DIR" 2>/dev/null || true
gtk-update-icon-cache -f -t "$ICON_DIR" 2>/dev/null || true

echo "AuralFlow installed."
echo "  Launcher : $APP_DIR/auralflow.desktop"
echo "  Command  : auralflow"
echo
echo "Open it from your application menu, or run 'auralflow'."
if [[ ! -x "$ROOT/backend/venv/bin/python" ]]; then
  echo
  echo "Note: the AI DJ needs the Python environment:"
  echo "  python3 -m venv backend/venv"
  echo "  backend/venv/bin/pip install torch==2.9.0 --index-url https://download.pytorch.org/whl/cpu"
  echo "  backend/venv/bin/pip install -r backend/requirements.txt"
fi
