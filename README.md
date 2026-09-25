# 🎧 AuralFlow: AI-Powered Smart Music Player

> An intelligent music player that automatically curates and transitions songs in real time based on your mood, listening behavior, and emotional flow. Streams high-quality FLAC audio for free via **[Monochrome](https://github.com/monochrome-music/monochrome)**.

## 🌟 What Makes AuralFlow Special

AuralFlow isn't just another music player — it's your **AI DJ** that understands:
- Your emotional listening patterns, not just genres
- How your mood evolves during a session
- The perfect next song to match your flow

Example flow: `Avicii → Metallica → Sajda → Phonk remix → A.R. Rahman → Lo-fi chill`

AuralFlow sees this as a **coherent emotional arc**, not random genre-hopping.

---

## 🏗️ Architecture

AuralFlow is a **native app**, not a web page in a window. One process to
launch: the Tauri shell starts the audio engine and the recommendation backend
itself and shuts them down with the window.

```
┌──────────────────────────────────────────────────────────────┐
│  Native shell (Tauri 2)                                      │
│  Windows · macOS · Linux · Android · iOS                     │
│  Custom window toolbar, system tray, single instance,        │
│  remembered window geometry                                  │
│                                                              │
│  ┌─── Regular layout (desktop windows) ──────────────────┐   │
│  │ Toolbar: ‹ › · search · engine status · inspector     │   │
│  │ ┌────────┬──────────────────┬──────────────────────┐  │   │
│  │ │Sidebar │ Content          │ Audio Engine rail    │  │   │
│  │ │Discover│ shelves / lists  │ telemetry, spectrum, │  │   │
│  │ │Library │                  │ queue, mood vector   │  │   │
│  │ └────────┴──────────────────┴──────────────────────┘  │   │
│  │ Player bar: art · transport · progress · volume       │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─── Compact layout (phones, narrow windows) ───────────┐   │
│  │ Full-bleed content, safe-area aware                    │  │
│  │ Mini player → tap raises the Now Playing sheet         │  │
│  │ Platform tab bar: Listen Search Library Queue Audio    │  │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  Services the shell manages:                                 │
│  ├── Monochrome audio engine   (Node,   :5173)              │
│  └── Recommendation backend    (Python, :8000)              │
└──────────────────────────────────────────────────────────────┘
                               │ HTTP (JSON)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  FastAPI backend                                             │
│  /recommendations/score     rank candidates with the agent   │
│  /recommendations/feedback  train on plays, skips, likes     │
│  /recommendations/mood      genre → 5-D mood vector          │
│  /recommendations/stats     exploration rate, buffer, steps  │
│  SQLite by default; PyTorch DQN in ml/agents                 │
└──────────────────────────────────────────────────────────────┘
```

### Layouts

The UI picks its layout from the window width, not the platform, so a resized
desktop window and a tablet in portrait both get whatever actually fits. Track
lists use **container queries**: columns drop out based on the list's own
width, because these lists sit beside the inspector rail and a wide window does
not mean a wide list.

### Design system

Tokens come from `stitch_design_system/` — the Material-style surface ramp
(`#0d0e12` → `#343539`), `#aac7ff` / `#3e90ff` accents, the quality colours
(hi-res `#a855f7`, lossless `#10b981`, Atmos `#3b82f6`), and the Inter type
scale. The desktop workstation board supplies the sidebar sections, bitstream
telemetry and spectrum widgets; the vision boards supply the Now Playing
waveform, control pod and the Audio Quality settings screen.

---

## 🚀 Getting Started

Full setup, packaging and mobile instructions live in
**[QUICKSTART.md](QUICKSTART.md)**. The short version:

### Prerequisites

- **Rust** (stable) — builds the native shell
- **Node.js 20+** — the UI and the audio engine
- **Python 3.11+** — the recommendation backend
- **[Monochrome](https://github.com/monochrome-music/monochrome)** — the audio engine. A separate project, not committed here; fetch it into `monochrome_app/` at the commit `engine/vendor.json` pins. Keep it current, or playback stops working quietly ([why](engine/README.md))
- On Linux, the webview system libraries (`webkit2gtk-4.1` and friends — see QUICKSTART)

No database account is needed. The backend uses a local SQLite file
(`backend/auralflow.db`), created on first start.

### Install

```bash
cd frontend && npm install && cd ..
cd desktop && npm install && cd ..
python3 -m venv backend/venv && backend/venv/bin/pip install -r backend/requirements.txt
git clone https://github.com/monochrome-music/monochrome monochrome_app
git -C monochrome_app checkout 88481062d398
node engine/apply.mjs
cd monochrome_app && npm install && cd ..
```

### Run

```bash
cd desktop && npm run dev
```

One command. The shell starts Monochrome and the backend as child processes and
kills them when the window closes — including when it is killed outright, so
nothing is left holding a port afterwards.

To work on the UI in a browser instead, `python3 start.py` brings up all three
services with health checks and prints what is listening; it names anything
that is missing rather than failing silently.

### Install

To have AuralFlow open from the application menu like any other player:

```bash
cd desktop && npm run build && cd ..
./desktop/install-local.sh
```

### Package

```bash
cd desktop && npm run build      # installers in src-tauri/target/release/bundle/
```

The interface and the audio engine are rebuilt first if either is out of date,
so this is the only command needed. The engine ships inside the app; an
installed copy needs no Node.js at runtime.

### Phones

```bash
cd desktop
npm run android:init && npm run android:dev
npm run ios:init && npm run ios:dev          # macOS + Xcode
```

A phone cannot host the Node and Python services, so point it at a machine that
can via `NEXT_PUBLIC_MONOCHROME_URL` and `NEXT_PUBLIC_API_BASE`
(see `frontend/.env.example`).

---

## 📁 Project Structure

```
AuralFlow/
├── backend/                    # FastAPI backend
│   └── app/
│       ├── api/endpoints/      # auth, sessions, recommendations
│       ├── core/               # config & security
│       ├── db/                 # SQLAlchemy session + base
│       ├── models/             # User, Song, Session, Transition
│       └── services/           # mood mapping, track + recommendation services
├── ml/
│   └── agents/music_rl_agent.py   # PyTorch DQN over a 5-D mood space
├── frontend/                   # Next.js UI (static export)
│   ├── app/                    # shell, layout, design tokens
│   ├── components/
│   │   ├── Toolbar.tsx         # the only top chrome: window controls + search
│   │   ├── Sidebar.tsx         # desktop navigation, mood flow, AI DJ status
│   │   ├── TabBar.tsx          # platform tab bar (compact layout)
│   │   ├── PlayerBar.tsx       # desktop transport
│   │   ├── MiniPlayer.tsx      # compact transport
│   │   ├── AudioEngineRail.tsx # inspector: telemetry, spectrum, queue, mood
│   │   ├── NowPlayingScreen.tsx
│   │   ├── TrackRow.tsx        # container-query track row
│   │   ├── Rail.tsx            # shared seek / volume slider
│   │   ├── Equalizer.tsx       # bands + the adaptive stabiliser
│   │   ├── ImportPanel.tsx     # bring a library across from another service
│   │   ├── LyricsPane.tsx      # synced lyrics
│   │   └── *Tab.tsx            # Home, Search, Library, Queue, Settings
│   ├── hooks/
│   │   ├── useMonochrome.ts    # postMessage bridge to the audio engine
│   │   ├── useKeyboardShortcuts.ts
│   │   └── useFormFactor.ts    # regular vs compact layout
│   ├── lib/                    # API client + formatting/quality helpers
│   └── stores/playerStore.ts   # Zustand app state
├── engine/                     # our additions to the vendored audio engine
│   ├── auralflow-bridge.js     # the whole integration, grafted on at build
│   ├── patches/                # small edits to engine source
│   └── apply.mjs               # puts both back after a re-vendor
├── desktop/                    # Tauri shell
│   └── src-tauri/
│       ├── src/lib.rs          # window, tray, single instance, window state
│       ├── src/services.rs     # starts/stops Monochrome + backend
│       ├── capabilities/       # Tauri v2 permissions
│       └── icons/              # app icons
├── stitch_design_system/       # Stitch design boards the UI is built from
└── start.py                    # dev launcher with health checks
```

## 🧠 How It Works

### 1. Mood Vector Computation
Every song is represented as a **5D mood vector** derived from its genre metadata:
```python
[energy, valence, danceability, acousticness, instrumentalness]
```

Example:
- `EDM / Dance`: `[0.9, 0.7, 0.9, 0.1, 0.1]` → "Energetic & Uplifting"
- `Lo-fi chill`: `[0.2, 0.6, 0.4, 0.8, 0.7]` → "Calm & Peaceful"

### 2. Mood Flow Tracking
As you listen, AuralFlow tracks:
- Your **current mood state**
- **Recent mood trajectory** (last 5-10 songs)
- **Listening patterns** (time of day, skip behavior, etc.)

### 3. Reinforcement Learning
The RL agent learns from your behavior:

**Rewards:**
- **+1.0**: Liked or replayed a song
- **+0.5**: Played fully (>80%)
- **-1.0**: Skipped early (<20%)

**Policy:** The neural network learns to predict which songs you'll enjoy based on your current mood state.

---

## 🔌 API Endpoints

### Authentication
- `GET /api/v1/auth/login` - Local auto-login
- `GET /api/v1/auth/me` - Get current user

### Recommendations
- `POST /api/v1/recommendations/score` - Score and rank candidate tracks
- `POST /api/v1/recommendations/feedback` - Submit listening feedback
- `POST /api/v1/recommendations/mood` - Compute mood vector for a track
- `GET /api/v1/recommendations/stats` - Agent status: exploration rate, replay-buffer size, training steps

### Sessions
- `POST /api/v1/sessions/start` - Start listening session
- `PUT /api/v1/sessions/{id}/end` - End session
- `POST /api/v1/sessions/{id}/transition` - Record song transition
- `GET /api/v1/sessions/{id}` - Get session details

---

## 🎯 Roadmap

### Phase 1: Core MVP ✅
- ✅ Backend API with SQLite
- ✅ Monochrome integration (FLAC streaming)
- ✅ Mood analysis engine (genre → 5D vector)
- ✅ RL agent implementation
- ✅ Tauri desktop app

### Phase 2: Native shell ✅
- ✅ Native window chrome — one toolbar, no page header or navbar
- ✅ Desktop layout: sidebar, content, audio-engine inspector, player bar
- ✅ Compact layout: mini player + platform tab bar, safe-area aware
- ✅ Services auto-started and stopped by the shell
- ✅ System tray controls, single instance, remembered window geometry
- ✅ Keyboard shortcuts
- ✅ Audio Lab settings, persisted locally
- ✅ Android / iOS build targets wired up

### Phase 3: Library and sound ✅
- ✅ Real FFT spectrum, read from the engine's own analyser
- ✅ Equaliser: 16 bands, presets, preamp
- ✅ Adaptive stabiliser — learns the balance of what you play and pulls
     outliers toward it, so masters stop jumping at each other on shuffle
- ✅ Queue is the engine's own: add, play next, drag to reorder, remove
- ✅ Playlists, and importing a library from Spotify, Apple Music and others
- ✅ Time-synced lyrics
- ✅ Downloads to the music folder
- ✅ Catalogue and streaming backends configurable at runtime

### Phase 4: Next
- [ ] Bundle a Python runtime so installers are fully self-contained
- [ ] Persist the queue across restarts
- [ ] Historical mood analytics; playlists generated from mood arcs
- [ ] Offline playback from downloaded files
- [ ] Multi-user support

---

## 🙏 Acknowledgements

**[Monochrome](https://github.com/monochrome-music/monochrome)**: AuralFlow uses the incredible Monochrome open-source music player as our underlying FLAC audio engine and music discovery source. Huge thanks to the Monochrome team for making high-quality, privacy-respecting audio accessible!

---

## 🎵 Philosophy

> "Music is emotional, not categorical."

AuralFlow doesn't care if you jump from EDM to classical to Bollywood — it understands the **emotional thread** connecting your listening journey.

Built for people who don't just listen to music, but **live inside it**.

---

**Made with ❤️ and AI**
