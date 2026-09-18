# AuralFlow — Complete System Documentation

> An AI-driven music player that learns your taste in real-time using reinforcement learning. Runs as a standalone desktop app (Tauri) with a premium dark-mode UI, streaming real music via an embedded open-source music engine (Monochrome), and ranking tracks with a live PyTorch Q-learning agent.

---

## Table of Contents

1. [What Is AuralFlow](#1-what-is-auralflow)
2. [Architecture Overview](#2-architecture-overview)
3. [Project Structure](#3-project-structure)
4. [The Four Layers](#4-the-four-layers)
5. [Data Flow](#5-data-flow)
6. [The RL Agent — How It Learns](#6-the-rl-agent--how-it-learns)
7. [The Monochrome Bridge — How Music Plays](#7-the-monochrome-bridge--how-music-plays)
8. [Database Schema](#8-database-schema)
9. [API Reference](#9-api-reference)
10. [Design System](#10-design-system)
11. [State Management](#11-state-management)
12. [File Reference](#12-file-reference)
13. [How To Run](#13-how-to-run)
14. [Known Limitations](#14-known-limitations)

---

## 1. What Is AuralFlow

AuralFlow is a **standalone desktop music player** that uses a **reinforcement learning agent** to personalize what you hear. It doesn't just shuffle — it watches how you listen (play, skip, like, replay) and trains a neural network in real-time to predict what you'll want next.

**Key properties:**

| Property | Detail |
|----------|--------|
| **Music source** | Real tracks streamed via Monochrome (Tidal/open music APIs) |
| **AI model** | PyTorch Q-learning agent with experience replay and epsilon-greedy exploration |
| **Desktop app** | Tauri v2 (Rust native shell, 440x780 window) |
| **Frontend** | Next.js 15, React 19, TypeScript, Zustand, Framer Motion |
| **Backend** | FastAPI, SQLAlchemy, SQLite (local, zero-config) |
| **Audio quality** | Supports Lossless, Hi-Res Lossless, Dolby Atmos metadata display |
| **Visual** | WebGL shader background, glass-morphism panels, premium dark mode |

---

## 2. Architecture Overview

The app is four layers stacked together:

```
┌──────────────────────────────────────┐
│  Tauri Desktop Shell (440x780)       │
│  ┌────────────────────────────────┐  │
│  │  Next.js Frontend (React)      │  │
│  │  ┌──────────┐ ┌─────────────┐  │  │
│  │  │ UI Tabs  │ │ Hidden      │  │  │
│  │  │ Home     │ │ iframe      │  │  │
│  │  │ Search   │ │ (Monochrome │  │  │
│  │  │ Library  │ │  Engine)    │  │  │
│  │  │ Queue    │ │             │  │  │
│  │  │ Player   │ │ postMessage │  │  │
│  │  └──────────┘ └──────┬──────┘  │  │
│  └───────────────────────┼────────┘  │
└──────────────────────────┼───────────┘
                           │ HTTP
               ┌───────────┴───────────┐
               │  FastAPI Backend      │
               │  ┌─────────────────┐  │
               │  │ RL Agent        │  │
               │  │ (PyTorch)       │  │
               │  │ Mood Service    │  │
               │  │ Session Tracker │  │
               │  │ SQLite DB       │  │
               │  └─────────────────┘  │
               └───────────────────────┘
```

**The critical insight**: AuralFlow does NOT play music itself. It uses Monochrome (a full music web app) as a hidden audio engine inside an iframe. The AuralFlow UI sends commands (af:search, af:play, af:seek) via postMessage to the iframe, and receives events (af:timeupdate, af:trackloaded, af:statechange) back.

---

## 3. Project Structure

```
AuralFlow/
├── backend/                    # FastAPI + SQLAlchemy + RL integration
│   ├── app/
│   │   ├── api/endpoints/      # REST routes
│   │   │   ├── auth.py         # Local login, default user creation
│   │   │   ├── sessions.py     # Listening session CRUD + transitions
│   │   │   └── recommendations.py  # /score, /feedback, /mood
│   │   ├── core/
│   │   │   ├── config.py       # Settings (SQLite URL, CORS)
│   │   │   └── security.py     # JWT token creation (jose)
│   │   ├── db/
│   │   │   └── base.py         # SQLAlchemy engine + session factory
│   │   ├── models/             # SQLAlchemy ORM models
│   │   │   ├── user.py         # Users table
│   │   │   ├── song.py         # Songs cache table
│   │   │   ├── session.py      # Listening sessions table
│   │   │   └── transition.py   # Song transitions table
│   │   ├── services/           # Business logic
│   │   │   ├── mood_service.py       # Mood vectors, trajectories, prediction
│   │   │   ├── mood_mapper.py        # Genre to 5D mood vector lookup
│   │   │   ├── track_service.py      # Track enrichment with mood data
│   │   │   └── recommendation_service.py  # Orchestrates RL + mood scoring
│   │   └── main.py             # FastAPI app, startup, router mounting
│   ├── .env                    # Database URL, secrets
│   └── venv/                   # Python virtual environment
│
├── frontend/                   # Next.js 15 (App Router)
│   ├── app/
│   │   ├── page.tsx            # Main shell — nav, control pod, tabs
│   │   ├── layout.tsx          # Root layout
│   │   └── globals.css         # CSS design system + glass panels
│   ├── components/
│   │   ├── HomeTab.tsx         # Home: hero, mood flow, discover, for-you
│   │   ├── SearchTab.tsx       # Search: input, top result, track list
│   │   ├── LibraryTab.tsx      # Library: liked, recent, filter chips
│   │   ├── QueueTab.tsx        # Queue: now playing, up next, AI suggests
│   │   ├── NowPlayingScreen.tsx # Full-screen: waveform, controls, badges
│   │   └── ShaderBackground.tsx # WebGL animated background shader
│   ├── hooks/
│   │   └── useMonochrome.ts    # Bridge hook — iframe comms + AI scoring
│   ├── lib/
│   │   └── api.ts              # HTTP client for FastAPI backend
│   └── stores/
│       └── playerStore.ts      # Zustand store — all app state
│
├── ml/                         # Machine learning
│   └── agents/
│       └── music_rl_agent.py   # PyTorch RL agent (Q-learning + replay)
│
├── monochrome_app/             # Embedded music engine (Monochrome fork)
│   ├── js/
│   │   ├── auralflow-bridge.js # postMessage bridge
│   │   ├── player.js           # Audio player
│   │   ├── music-api.js        # Track search/streaming API
│   │   └── ...                 # ~80 other Monochrome modules
│   └── ...
│
├── desktop/                    # Tauri v2 desktop wrapper
│   ├── src-tauri/
│   │   ├── src/main.rs         # Rust entry point (8 lines)
│   │   ├── tauri.conf.json     # Window size, CSP, build config
│   │   └── Cargo.toml          # Rust dependencies
│   └── ...
│
├── start.py                    # Unified launcher
└── AGENTS.md                   # Repository guidelines
```

---

## 4. The Four Layers

### Layer 1: Desktop Shell (Tauri)

A Rust-native desktop window (Tauri v2) that wraps the Next.js frontend.

- Window: **440x780** (mobile phone form factor)
- Min: 360x500, resizable
- Transparent background
- CSP allows iframe from localhost (Monochrome), images from Tidal CDN
- Rust code: 8 lines. Just boots Tauri. All logic lives in web layer.

### Layer 2: Frontend UI (Next.js)

Next.js 15.5, React 19, TypeScript, Zustand, Framer Motion, Lucide Icons.

The single-page app renders:
1. **WebGL shader background** — animated noise blue/purple gradient
2. **Top bar** — AuralFlow logo with animated pulse dot
3. **Tab content** — AnimatePresence switches between 4 tabs
4. **Control pod** — mini now-playing bar with art, info, play/pause, skip, progress
5. **Bottom nav** — floating glass pill with 4 tab icons
6. **Now Playing** — full-screen modal with waveform, volume

**Screens:**

| Screen | Purpose |
|--------|---------|
| Home | Hero card (first search result), mood flow indicator, recently played horizontal scroll, AI-ranked "For You" list |
| Search | Glass search input with 400ms debounce, top result card with AI score, track list with quality badges |
| Library | Filter chips (All/Liked/Recent), liked songs gradient banner, track list with hearts |
| Queue | Now playing card with blurred art bg, numbered "up next", AI suggestions section |
| Now Playing | Full-screen: bleed art bg, waveform progress (20 bars, memoized), transport controls, quality badge, volume |

All screens are **mobile-first** — designed for 440px width.

### Layer 3: Backend Intelligence (FastAPI)

FastAPI, SQLAlchemy, PyTorch, NumPy, Pydantic.

Startup flow:
1. Creates all DB tables
2. Auto-creates default user `local@auralflow.local`
3. Mounts 3 routers under `/api/v1/`

**Services:**

| Service | Responsibility |
|---------|----------------|
| MoodService | Compute mood vectors, label moods, compute distance/trajectory, predict next mood |
| MoodMapper | Genre to 5D mood vector lookup table (30+ genres) |
| TrackService | Enriches track metadata with mood vector and label |
| RecommendationService | Orchestrates mood prediction + RL scoring, returns ranked tracks |

### Layer 4: Music Engine (Monochrome)

Monochrome is a full open-source music web app (Vite + vanilla JS). AuralFlow embeds it in a hidden 1x1px iframe and controls it via postMessage.

The bridge (`auralflow-bridge.js`) waits for Player and MusicAPI singletons, then translates between the AuralFlow UI and Monochrome's internals.

---

## 5. Data Flow

### Search → Play → Learn (Full Cycle)

1. **User types** "ambient" in search
2. **Frontend** sends `af:search {query: "ambient"}` to Monochrome iframe
3. **Monochrome** calls `MusicAPI.searchTracks("ambient")`, serializes results
4. **Monochrome** emits `af:searchresults {results: [...]}` back to parent
5. **Frontend** stores results in Zustand, fires off `POST /score` to backend
6. **Backend** computes mood vectors for each candidate, runs RL agent (`policy_net(state+mood)`)
7. **Backend** returns ranked tracks with Q-value confidence scores
8. **Frontend** stores scores, displays in "For You" section sorted by AI confidence
9. **User taps** a track
10. **Frontend** sends `af:play {trackId, tracks, searchQuery}` to iframe
11. **Monochrome** sets queue, starts playback, emits `af:trackloaded`
12. **Frontend** calls `POST /mood` to get mood vector for the track
13. **Monochrome** sends `af:timeupdate` every 250ms with currentTime/duration
14. **Track ends**: Monochrome emits `af:statechange {state: "ended"}`
15. **Frontend** sends `POST /feedback` with play duration, skip/like data
16. **Backend** computes reward, stores experience, runs training step on RL agent
17. **RL agent** updates weights via backprop on replay buffer sample
18. **Next search** results are ranked with the improved model

---

## 6. The RL Agent — How It Learns

### Neural Network Architecture

```
MoodPolicyNetwork (17 dims in → 1 Q-value out)
├── Linear(17, 128) + ReLU + Dropout(0.2)
├── Linear(128, 128) + ReLU + Dropout(0.2)
├── Linear(128, 64) + ReLU
└── Linear(64, 1)  → Q-value for this (state, action) pair
```

### State Encoding (12 dimensions)

| Dims | Source | Description |
|------|--------|-------------|
| 0-4 | current_mood | Current 5D mood vector [energy, valence, danceability, acousticness, instrumentalness] |
| 5-9 | recent_moods | Average of last 10 mood vectors |
| 10 | time_of_day | morning=0.25, afternoon=0.5, evening=0.75, night=1.0 |
| 11 | device_type | web=0.33, mobile=0.66, desktop=1.0 |

### Action Encoding (5 dimensions)

The candidate song's mood vector [energy, valence, danceability, acousticness, instrumentalness]

**Total input**: 12 (state) + 5 (action) = **17 dimensions**

### Reward Function

| User Behavior | Reward |
|---------------|--------|
| Liked or replayed | **+1.0** |
| Played fully (>80%) | **+0.5** |
| Partial play (20-80%) | **+0.2 to +0.5** (scaled) |
| Skipped mid-song | **-0.3** |
| Skipped early (<20%) | **-1.0** |

### Training Details

- **Algorithm**: Q-Learning with experience replay
- **Replay buffer**: 10,000 experiences (deque)
- **Batch size**: 32
- **Exploration**: epsilon-greedy, starts 0.3, decays 0.995/step, min 0.05
- **Discount factor**: 0.95
- **Optimizer**: Adam (lr=0.001)
- **Loss**: MSE between predicted Q and Bellman target

### Mood Mapper (30+ genres)

The genre-to-mood mapping covers ambient, classical, jazz, blues, folk, lo-fi, chill, downtempo, pop, dance, electronic, techno, trance, house, hip-hop, rap, rock, metal, thrash metal, indie, alternative, country, R&B, soul, funk, reggae, and world music. Each maps to a 5D vector. Unknown genres get the default [0.5, 0.5, 0.5, 0.5, 0.5].

---

## 7. The Monochrome Bridge — How Music Plays

### Bridge Protocol

| Direction | Format | Messages |
|-----------|--------|----------|
| Parent → Bridge | `{ type: "af:<cmd>", ...data }` | search, play, pause, resume, toggle, seek, volume, next, prev, getstate, ping |
| Bridge → Parent | `{ type: "af:<evt>", ...data }` | ready, timeupdate (250ms), statechange, trackloaded, searchresults, state, error, pong |

### Track Serialization

The bridge converts Monochrome's internal track objects to:
```json
{
  "id": "string",
  "title": "string",
  "artist": "string",
  "album": "string",
  "albumId": "string|null",
  "duration": 0,
  "audioQuality": "HI_RES_LOSSLESS|LOSSLESS|...",
  "audioModes": ["DOLBY_ATMOS"],
  "cover": "https://resources.tidal.com/.../320x320.jpg",
  "coverLarge": "https://resources.tidal.com/.../640x640.jpg",
  "genre": "string",
  "trackNumber": 0,
  "isUnavailable": false
}
```

### Frontend Hook (useMonochrome)

The hook:
1. Manages the iframe ref and URL
2. Listens for all `af:` events from the iframe
3. Writes state changes directly to Zustand
4. Triggers AI automatically:
   - On `searchresults` → calls `POST /score` to rank tracks by confidence
   - On `trackloaded` → calls `POST /mood` to compute mood vector
   - On track change → calls `POST /feedback` with play duration for previous track
5. Exposes clean API: `search()`, `play()`, `toggle()`, `next()`, `prev()`, `seek()`, `volume()`

---

## 8. Database Schema

**Engine**: SQLite (local file `backend/auralflow.db`, zero-config)

### users
| Column | Type | Description |
|--------|------|-------------|
| id | Integer PK | Auto-increment |
| email | String UNIQUE | Default: local@auralflow.local |
| display_name | String | Default: "Local Audiophile" |
| mood_bias | Float | Overall mood tendency |
| avg_skip_rate | Float | Running average skip rate |
| avg_session_length | Float | Running average session minutes |
| is_active | Boolean | Default: true |
| created_at / updated_at | DateTime | Auto-managed |

### sessions
| Column | Type | Description |
|--------|------|-------------|
| id | Integer PK | |
| user_id | FK → users | |
| started_at / ended_at | DateTime | Session boundaries |
| mood_start / mood_end | JSON | 5D mood vectors |
| mood_trajectory | JSON | Array of mood states over time |
| total_songs_played/skipped | Integer | Counters |
| avg_energy / avg_valence | Float | Session-level stats |
| device_type | String | web, mobile, desktop |
| time_of_day | String | morning, afternoon, evening, night |

### transitions
| Column | Type | Description |
|--------|------|-------------|
| id | Integer PK | |
| session_id | FK → sessions | |
| from_song_id / to_song_id | String | Track IDs |
| was_played_fully/skipped/liked/replayed | Boolean | User behavior signals |
| play_duration_ms | Integer | How long the song was played |
| reward | Float | Computed RL reward |

### songs
| Column | Type | Description |
|--------|------|-------------|
| id | Integer PK | |
| track_id | String UNIQUE | Monochrome track ID |
| name / artist / album / genre | String | Metadata |
| energy / valence / danceability / acousticness / instrumentalness | Float | Audio features |
| mood_vector | JSON | 5D mood vector |

---

## 9. API Reference

**Base URL**: `http://localhost:8000/api/v1`

### POST /recommendations/score
Score and rank candidate tracks using the RL agent.

Request: `{ candidates: [{id, title, artist, genre}], current_mood: [5 floats], recent_moods: [[5 floats]], time_of_day, device_type, num_recommendations }`

Response: `{ recommendations: [{...track, confidence, mood_vector, mood_label, mood_distance, predicted_mood}], predicted_mood, count }`

### POST /recommendations/feedback
Submit user feedback to train the RL agent.

Request: `{ track_id, song_mood_vector, state: {current_mood, recent_moods}, was_played_fully, was_skipped, was_liked, was_replayed, play_duration_ms, total_duration_ms }`

Response: `{ success, reward, training_loss, exploration_rate }`

### POST /recommendations/mood
Compute mood vector for a single track.

Request: `{ id, title, artist, genre }`

Response: `{ track_id, mood_vector: [5 floats], mood_label: "Danceable & Rhythmic" }`

### POST /sessions/start
Start a listening session. Request: `{ device_type, time_of_day, mood_start }`

### PUT /sessions/{id}/end
End a listening session with stats.

### POST /sessions/{id}/transition
Record a song transition with behavior signals.

### GET /auth/login
Auto-login: creates default user on first call, returns JWT redirect.

### GET /auth/me
Get current user info.

---

## 10. Design System

### Color Palette
- **Primary**: `#3e90ff` (AuralFlow Blue)
- **Background**: `#000000` (Pure black)
- **Surface**: `#121317` (Cards)
- **Text**: `#e3e2e7` (Primary)
- **Text Dim**: `#8b91a0` (Secondary)
- **Glass**: `rgba(18, 19, 23, 0.6)`

### Quality Badge Colors
| Quality | Color |
|---------|-------|
| Hi-Res Lossless | Purple (`#a855f7`) |
| Lossless | Emerald (`#10b981`) |
| Dolby Atmos | Blue (`#3b82f6`) |

### Glass Panels
```css
background: rgba(18, 19, 23, 0.6);
backdrop-filter: blur(20px);
border: 1px solid rgba(255, 255, 255, 0.05);
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.37);
```

### Typography
- Font: Inter (Google Fonts, 400/600/700/900)
- Headlines: 24-32px, weight 600-700, tight tracking
- Body: 13-15px, weight 400
- Labels: 9-11px, weight 600-700, uppercase

### WebGL Shader
Full-screen animated noise shader with AuralFlow Blue and Hi-Res Purple stops, perlin noise, mouse-reactive glow, vignette, runs at display refresh rate.

---

## 11. State Management

**Engine**: Zustand (single global store, no providers)

| Group | Fields | Updated By |
|-------|--------|------------|
| Navigation | activeTab | Bottom nav clicks |
| Playback | track, playing, loading, currentTime, duration, volume | Monochrome bridge events |
| Queue | queue, queueIndex | Track selection |
| Search | searchResults, searchQuery, searching | Bridge searchresults event |
| Library | liked (Set), recentlyPlayed (max 50) | User likes, trackloaded event |
| AI | aiScores (Map), currentMood, recentMoods | Backend /score and /mood responses |
| UI | isExpanded, monoReady | User actions, bridge ready event |

---

## 12. File Reference

### Frontend (11 files)

| File | Lines | Purpose |
|------|-------|---------|
| page.tsx | 257 | App shell, nav, control pod, iframe |
| globals.css | ~200 | Full design system |
| playerStore.ts | 157 | Zustand state store |
| useMonochrome.ts | 171 | Bridge hook |
| api.ts | 133 | Backend HTTP client |
| HomeTab.tsx | 185 | Home screen |
| SearchTab.tsx | ~200 | Search screen |
| LibraryTab.tsx | ~130 | Library screen |
| QueueTab.tsx | ~180 | Queue screen |
| NowPlayingScreen.tsx | ~250 | Full-screen player |
| ShaderBackground.tsx | 172 | WebGL shader |

### Backend (12 files)

| File | Lines | Purpose |
|------|-------|---------|
| main.py | 64 | FastAPI app + startup |
| config.py | 51 | Settings (SQLite) |
| security.py | 34 | JWT creation |
| base.py | 25 | SQLAlchemy engine |
| user.py | 26 | User model |
| song.py | 27 | Song cache model |
| session.py | 35 | Session model |
| transition.py | ~35 | Transition model |
| recommendation_service.py | 171 | RL orchestration |
| mood_service.py | 169 | Mood math |
| mood_mapper.py | 54 | Genre-to-mood table |
| track_service.py | 47 | Track enrichment |

### ML (1 file)

| File | Lines | Purpose |
|------|-------|---------|
| music_rl_agent.py | 305 | Full RL agent: network, encoding, training, rewards, save/load |

### Bridge (1 file)

| File | Lines | Purpose |
|------|-------|---------|
| auralflow-bridge.js | 262 | postMessage protocol between AuralFlow and Monochrome |

---

## 13. How To Run

### Prerequisites
- Python 3.11+ with venv
- Node.js 18+
- Rust + Cargo (for Tauri desktop build)
- Xcode CLT (macOS: `sudo xcodebuild -license`)

### Quick Start
```bash
python start.py          # Monochrome + Backend + Frontend
python start.py --app    # + Tauri desktop window
```

### Services
| Service | Port | Command |
|---------|------|---------|
| Monochrome | 5173 | `cd monochrome_app && npm run dev` |
| Backend | 8000 | `cd backend && source venv/bin/activate && uvicorn app.main:app --reload` |
| Frontend | 3000 | `cd frontend && npm run dev` |
| Desktop | — | `cd desktop && npx @tauri-apps/cli dev` |

### Verify Backend
```bash
cd backend && source venv/bin/activate
python -c "
from app.services.recommendation_service import recommendation_service
r = recommendation_service.score_candidates(
    candidates=[{'id':'1','title':'Test','artist':'A','genre':'rock'}],
    current_mood=[0.5,0.5,0.5,0.5,0.5], recent_moods=[]
)
print(f'RL Agent confidence: {r[0][\"confidence\"]:.4f}')
"
```

---

## 14. Known Limitations

| Area | Limitation | Workaround |
|------|-----------|------------|
| Music source | Depends on Monochrome's upstream APIs | Monochrome community maintains proxies |
| RL cold start | Agent is random until ~30-50 plays | Initial "lossless" query seeds good content |
| Mood heuristic | Static genre lookup, not per-track audio analysis | Future: audio feature APIs |
| Offline | Requires internet for streaming | Download support possible via Monochrome |
| Single user | No multi-user support | JWT infra exists but auto-login only |
| Model persistence | RL resets on restart | save/load exists, needs auto-trigger |
| Supabase dead | Original PostgreSQL is offline | Switched to local SQLite |
