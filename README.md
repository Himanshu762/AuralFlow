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

```
┌─────────────────────────────────────────────┐
│  Desktop App (Tauri ~20MB RAM)              │
│  Native macOS/Windows/Linux window          │
│  Uses system WebKit (no Chromium)           │
├─────────────────────────────────────────────┤
│  Web App (Next.js on :3000)                 │  ← same code
│  Search via Monochrome (browser, :5173)     │
│  HTML5 <audio> FLAC playback                │
│  Mood visualization + AI DJ controls        │
└──────────────┬──────────────────────────────┘
               │ HTTP (JSON)
               ▼
┌─────────────────────────────────────────────┐
│  Backend (FastAPI on :8000)                 │
│  RL Agent scoring & training                │
│  Mood mapping (genre → 5D vector)           │
│  Session tracking                           │
│  Supabase (PostgreSQL)                      │
└─────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **Supabase account** (free tier works — [supabase.com](https://supabase.com))
- **Rust** (only for the desktop app — optional)

---

### 1️⃣ Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure your Supabase connection
# Edit .env and set DATABASE_URL to your Supabase connection string
# (Dashboard → Settings → Database → Connection string → URI)
cp .env.example .env
# Then edit .env with your Supabase credentials

# Start the backend (tables are auto-created on first startup)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend will be available at: `http://localhost:8000`
API docs (Swagger): `http://localhost:8000/docs`

> **Note:** Get your Supabase connection string from: Dashboard → Settings → Database → Connection string (URI). Tables are auto-created on first startup.

---

### 2️⃣ Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

Frontend will be available at: `http://localhost:3000`

---

### 3️⃣ Monochrome Setup

AuralFlow uses [Monochrome](https://github.com/monochrome-music/monochrome) as its music discovery and FLAC streaming engine.

```bash
cd monochrome_app
npm install
npm run dev
```

Monochrome will run on `http://localhost:5173`.

---

### 4️⃣ Desktop App (Optional)

The desktop app wraps the web UI in a native window using [Tauri](https://tauri.app/) — only ~20MB RAM vs Electron's 300MB.

```bash
# Requires Rust: https://rustup.rs
cd desktop/src-tauri
cargo tauri dev
```

---

## 📁 Project Structure

```
AuralFlow/
├── backend/              # FastAPI backend
│   ├── app/
│   │   ├── api/
│   │   │   └── endpoints/    # REST endpoints
│   │   │       ├── auth.py
│   │   │       ├── sessions.py
│   │   │       └── recommendations.py
│   │   ├── core/             # Config & security
│   │   ├── db/               # Database setup (SQLite)
│   │   ├── models/           # SQLAlchemy models
│   │   └── services/         # Business logic
│   │       ├── track_service.py
│   │       ├── mood_service.py
│   │       ├── mood_mapper.py
│   │       └── recommendation_service.py
│   ├── requirements.txt
│   └── .env
├── ml/                   # Machine learning
│   ├── agents/
│   │   └── music_rl_agent.py
│   └── models/
├── frontend/             # Next.js frontend
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx          # Main music player UI
│   │   └── globals.css
│   └── public/
├── desktop/              # Tauri desktop app
│   └── src-tauri/
│       ├── Cargo.toml
│       ├── tauri.conf.json
│       └── src/main.rs
├── monochrome_app/       # Self-hosted Monochrome instance
└── docs/                 # Documentation
```

---

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
- ✅ Frontend player UI
- ✅ Mood visualization
- ✅ Tauri desktop app

### Phase 2: Enhancement
- [ ] Historical mood analytics dashboard
- [ ] Playlist generation from mood arcs
- [ ] Offline mode with cached tracks
- [ ] System tray controls (desktop)

### Phase 3: Mobile & Expansion
- [ ] Flutter mobile app (iOS + Android)
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
