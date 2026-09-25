# 🎧 AuralFlow: AI-Powered Smart Music Player

> A lossless music player with a DJ that listens. It measures every track's mood from the audio as it plays, chooses what follows from your own library along an arc you set, and queues it — and it shapes the sound for whatever is playing it. Streams FLAC via **[Monochrome](https://github.com/monochrome-music/monochrome)**.

## 🌟 What Makes AuralFlow Different

Most players give you a library and a shuffle button. AuralFlow gives you a **Flow**:

- **It listens.** While a track plays, the engine measures it — loudness, dynamics, brightness, tempo, key and mode, how much of the energy is a voice — and turns that into a five-dimensional mood. No genre tag, no third-party feature API. The reading is labelled with how much audio it rests on.
- **It has a library of its own.** Everything you search, play, import or look up becomes a candidate. The DJ chooses from that, not from whatever you last typed.
- **It follows an arc.** Hold, drift, lift, settle, focus, or draw your own target. The next pick is chosen for where the session is going, ranked by a reinforcement-learning policy that learns from plays, skips, likes and every "not this one" — and it goes straight into the queue.
- **It tells you why.** Every pick comes with its reason, its fit to the target, and where its mood reading came from. Exploration is labelled as discovery, not passed off as confidence.
- **It sounds right on any device.** One *Sound Signature* stacks a correction for the output device (matched from AutoEQ by the device's name and remembered per device), a live stabiliser for the record playing now, and loudness compensation that grows as the volume comes down — all on top of your own EQ, all reversible.

Example flow: `Avicii → Metallica → Sajda → Phonk remix → A.R. Rahman → Lo-fi chill` is a **coherent emotional arc** to AuralFlow, not genre-hopping.

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
│  /library          the candidate pool: tracks, measured      │
│                    moods, plays, likes                        │
│  /dj/next          what plays next, along the session arc    │
│  /recommendations  rank a list · feedback · one track's mood │
│  SQLite by default; PyTorch Q-network in ml/agents           │
└──────────────────────────────────────────────────────────────┘
```

The engine bridge (`engine/auralflow-bridge.js`) is where the listening
happens: it reads the engine's analyser while audio plays, reports measured
features to the shell, composes the Sound Signature layers onto the running
EQ filters, and tracks the output device.

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
│       ├── api/endpoints/      # library, dj, recommendations, sessions, auth
│       ├── core/               # config & security
│       ├── db/                 # SQLAlchemy session + schema upkeep
│       ├── models/             # Song (the library), User, Session, Transition
│       └── services/           # feature → mood mapping, library, dj, recommendation
├── ml/
│   └── agents/music_rl_agent.py   # PyTorch Q-network over mood + arc target
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
│   │   ├── Equalizer.tsx       # the listener's own bands
│   │   ├── FlowCard.tsx        # the DJ: arcs, next pick, reasons, rejection
│   │   ├── MoodMeter.tsx       # the mood reading and its provenance
│   │   ├── SoundSignature.tsx  # output device, correction, stabiliser, loudness layers
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
│   ├── auralflow-bridge.js     # the whole integration: protocol, analysis, signature, devices
│   ├── patches/                # small edits to engine source
│   ├── test/selftest.mjs       # synthetic-audio check of the analyser and EQ layers
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

### 1. Mood, measured
Every track is a **5-D mood vector** — `[energy, valence, danceability,
acousticness, instrumentalness]` — read from the audio as it plays. The
bridge measures loudness, crest factor, dynamic range, spectral centroid and
flatness, spectral flux, band energy ratios, tempo and beat strength, key and
major/minor. The backend maps those onto the five dimensions and caches the
result per track, with a confidence that grows with the seconds heard. Until a
track has been heard, its mood comes from an artist prior (other measured
tracks by the same artist) or its genre tag, and the UI says which.

### 2. The arc
A session has a direction. **Hold** keeps the mood; **Drift** follows the
momentum of the last few tracks; **Lift** raises energy and brightness a step
a track; **Settle** winds down toward acoustic, instrumental material;
**Focus** heads for mid-energy instrumental and stays; **Custom** heads for a
vector you set over a number of tracks. The arc turns the current mood into a
target for the next track.

### 3. The pick
The DJ ranks the library against that target: the policy's Q-value blended
with mood fit, with terms for novelty, likes, past reward, recency and artist
diversity. The policy's share grows as it trains, so early sessions lean on
the arc and later ones on what it has learnt. Some picks are exploration —
preferably tracks that have never been measured — and they are labelled as
discoveries. The pick is queued behind the playing track automatically.

### 4. Learning
**Rewards:** +1 liked or replayed · +0.5 played fully · +0.2..0.5 partial ·
−0.3 skipped mid-song · −1 skipped early · −0.5 rejected before it played.
Feedback carries the *next* state and the next track's mood, so the update
bootstraps from the transition you actually took.

### 5. Sound Signature
Three automatic EQ layers on top of your own curve: a **device** correction
matched from AutoEQ by the output device's name (or chosen by hand) and
remembered per device; a **track** stabiliser measured live that pulls each
record toward the balance of what you normally play; and **loudness**
compensation that adds back bass and a little treble as the volume drops. The
settings screen draws all four layers and the total the filters are running.

---

## 🔌 API Endpoints

### Authentication
- `GET /api/v1/auth/login` - Local auto-login
- `GET /api/v1/auth/me` - Get current user

### Library
- `POST /api/v1/library/tracks` - Add or refresh tracks in the candidate pool
- `POST /api/v1/library/features` - Store what the engine measured from a track's audio
- `POST /api/v1/library/event` - Record a play, like or unlike
- `GET /api/v1/library/pool` - The pool with moods, provenance and history
- `GET /api/v1/library/stats` - Counts by mood source

### DJ
- `POST /api/v1/dj/next` - What plays next, along the arc, with the reason
- `POST /api/v1/dj/reject` - A pick turned down before it played
- `GET /api/v1/dj/modes` - The arcs, policy weight and exploration rate

### Recommendations
- `POST /api/v1/recommendations/score` - Score and rank a list the shell hands over
- `POST /api/v1/recommendations/feedback` - Listening feedback, with the next state
- `POST /api/v1/recommendations/mood` - One track's mood, its source and confidence
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

### Phase 4: The DJ that listens ✅
- ✅ Mood measured from the audio (tempo, key/mode, loudness, dynamics, brightness, vocal band), cached per track with confidence
- ✅ A library the DJ owns: searches, plays, imports, album and artist lookups, likes and history
- ✅ Session arcs (hold, drift, lift, settle, focus, custom) and a closed loop: pick → queue next → feedback with the real next transition
- ✅ Every pick explained; exploration labelled as discovery; "not this" as a signal
- ✅ Sound Signature: per-device AutoEQ correction matched by device name, track stabiliser, loudness compensation — layered on the listener's EQ
- ✅ Output device detection and switching where the platform allows

### Phase 5: Next
- [ ] Bundle a Python runtime so installers are fully self-contained
- [ ] Persist the queue across restarts
- [ ] Pre-listen analysis of unheard tracks (decode ahead, off the main graph)
- [ ] Mood history and arcs replayed as playlists
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
