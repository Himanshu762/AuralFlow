# AuralFlow — Quick Start

AuralFlow is a native app: one window, one process to launch. It runs on
Windows, macOS and Linux, and the same UI builds for Android and iOS.

---

## What you need

| | Why | Minimum |
|---|---|---|
| **Rust + Cargo** | builds the native shell | stable toolchain |
| **Node.js** | the UI and the audio engine | 20+ |
| **Python** | the recommendation backend | 3.11+ |
| **Monochrome** | the audio engine — a separate project, fetched into `monochrome_app/` | see below |

Linux also needs the webview system libraries:

```bash
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl libayatana-appindicator librsvg
```

(Verified on CachyOS: `webkit2gtk-4.1` 2.52.6 plus `libayatana-appindicator`
and `librsvg` are enough to build and run.)

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

---

## First run

```bash
cd frontend && npm install && cd ..
cd desktop && npm install && cd ..
# The audio engine is a separate upstream project and is not in this repo.
git clone https://github.com/monochrome-music/monochrome monochrome_app
git -C monochrome_app checkout 88481062d3981e12be3bafaa6c8a6c4f8ab4b310
node engine/apply.mjs          # graft in AuralFlow's bridge
cd monochrome_app && npm install && cd ..
python3 -m venv backend/venv && backend/venv/bin/pip install -r backend/requirements.txt
```

The backend pulls PyTorch, so that last step downloads roughly a gigabyte.

Then launch the app:

```bash
cd desktop && npm run dev
```

That is the whole thing. The native shell starts the audio engine and the
recommendation backend itself and shuts them down when you close the window —
there is nothing else to run.

For everyday use, build it once and install it instead, so it lives in your
application menu like any other player:

```bash
cd desktop && npm run build && cd ..
./desktop/install-local.sh
```

---

## Running the UI in a browser instead

Useful when you are iterating on the interface and do not want to rebuild the
shell:

```bash
python3 start.py
```

This starts all three services with health checks and prints what is up. Open
<http://localhost:3000>. `python3 start.py --app` also launches the native
window against those services.

`start.py` tells you exactly what is missing if a dependency is not installed.

---

## Installing it like a normal app

Once built, register AuralFlow with the desktop so it opens from the
application menu — no terminal, nothing to start by hand:

```bash
./desktop/install-local.sh
```

That puts an `auralflow` command on your `PATH`, installs the icons, and writes
a launcher entry. From then on AuralFlow behaves like any other music player:
click it, and the window, the audio engine and the AI DJ all come up together;
close the window and they all go away.

---

## Packaging

```bash
cd desktop && npm run build
```

One command — it builds the audio engine and the interface first if either is
out of date, then the native shell. Installers land in
`desktop/src-tauri/target/release/bundle/` as `.deb`, `.rpm`, `.AppImage`,
`.msi` or `.dmg` depending on the host.

The audio engine is bundled inside the app, so an installed copy needs no
Node.js. The AI DJ is the exception: it needs a Python environment, which the
installers do not carry. Point `AURALFLOW_ROOT` at a checkout that has
`backend/venv` (`install-local.sh` does this for you) and the DJ comes up;
without it the player runs normally and reports the DJ as offline.

## Phones

```bash
cd desktop
npm run android:init && npm run android:dev   # needs Android Studio + NDK
npm run ios:init && npm run ios:dev           # needs Xcode, macOS only
```

A phone cannot run the Node and Python services locally, so point the app at a
machine that does. Create `frontend/.env.local`:

```
NEXT_PUBLIC_MONOCHROME_URL=http://192.168.1.20:5173
NEXT_PUBLIC_API_BASE=http://192.168.1.20:8000/api/v1
```

---

## Playback

The audio engine reaches its catalogue and streams through backend instances
it resolves at startup. Nothing needs configuring when the vendored engine is
current.

**If nothing plays, the vendored engine is probably stale.** Backend
infrastructure moved, and builds from before that migration point at hosts that
are offline. The failure is quiet — search still works, because it falls
through to a public metadata API, and artwork still loads — so the only symptom
is that pressing play does nothing at all.

The build warns about this, and `Settings → Catalogue & Streaming` shows which
backends the engine resolved, flagging it when there is no streaming instance.
The fix is to re-vendor; see [engine/README.md](engine/README.md).

You can also point the engine at your own endpoint from that settings screen,
or add an instance URL there. Both take effect immediately — no rebuild.

## Tests

```bash
cd backend && venv/bin/python -m pytest
```

## Keyboard

| Key | Action |
|---|---|
| `Space` | play / pause |
| `←` `→` | seek ∓10s |
| `↑` `↓` | volume ±5% |
| `Ctrl/⌘` + `←` `→` | previous / next track |
| `Ctrl/⌘` + `K` | search |
| `Ctrl/⌘` + `L` | like the current track |
| `Ctrl/⌘` + `1…5` | switch section |
| `M` `S` `R` | mute · shuffle · repeat |
| `Esc` | close Now Playing |
| `F11` | fullscreen |
