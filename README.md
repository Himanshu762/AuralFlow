# 🎧 AuralFlow: AI-Powered Smart Music Player

> An intelligent music layer built on top of Spotify that automatically curates and transitions songs in real time based on your mood, listening behavior, and emotional flow.

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
│  Frontend (Next.js + React)                 │
│  - Music player UI                          │
│  - Mood visualization                       │
│  - Spotify Web Playback SDK                 │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  Backend (FastAPI)                          │
│  - REST API                                 │
│  - Spotify OAuth & API integration          │
│  - Session & user management                │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  ML Engine (PyTorch)                        │
│  - Mood vector computation                  │
│  - Reinforcement learning agent             │
│  - Smart recommendation ranking             │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  Database (PostgreSQL)                      │
│  - Users, sessions, songs, transitions      │
└─────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.13+**
- **Node.js 18+**
- **PostgreSQL 14+**
- **Spotify Developer Account** (you mentioned you have credentials)

---

### 1️⃣ Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
# Edit .env with your Spotify credentials and database URL
```

**Configure `.env`:**
```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/api/auth/callback
DATABASE_URL=postgresql://auralflow:password@localhost:5432/auralflow_db
SECRET_KEY=generate_a_random_secret_key
```

**Set up PostgreSQL:**
```bash
# Create database
createdb auralflow_db

# Run migrations (once we set up Alembic)
alembic upgrade head
```

**Run the backend:**
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend will be available at: `http://localhost:8000`
API docs (Swagger): `http://localhost:8000/docs`

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

### 3️⃣ Spotify App Setup

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Add redirect URI: `http://localhost:3000/api/auth/callback`
4. Note your **Client ID** and **Client Secret**
5. Add them to `backend/.env`

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
│   │   ├── db/               # Database setup
│   │   ├── models/           # SQLAlchemy models
│   │   ├── schemas/          # Pydantic schemas
│   │   └── services/         # Business logic
│   │       ├── spotify_service.py
│   │       ├── mood_service.py
│   │       └── recommendation_service.py
│   ├── requirements.txt
│   └── .env
├── ml/                   # Machine learning
│   ├── agents/
│   │   └── music_rl_agent.py
│   ├── models/
│   └── utils/
├── frontend/             # Next.js frontend
│   ├── app/
│   ├── components/
│   └── public/
└── docs/                 # Documentation
```

---

## 🧠 How It Works

### 1. Mood Vector Computation
Every song is represented as a **5D mood vector**:
```python
[energy, valence, danceability, acousticness, instrumentalness]
```

Example:
- `Avicii - Wake Me Up`: `[0.8, 0.7, 0.6, 0.3, 0.1]` → "Energetic & Uplifting"
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

### 4. Smart Queueing
For each recommendation request:
1. **Predict** where your mood is heading
2. **Fetch** candidates from Spotify with matching features
3. **Rank** them using the trained RL policy
4. **Queue** the top pick automatically

---

## 🔌 API Endpoints

### Authentication
- `GET /api/v1/auth/login` - Initiate Spotify OAuth
- `GET /api/v1/auth/callback` - OAuth callback
- `GET /api/v1/auth/me` - Get current user

### Recommendations
- `POST /api/v1/recommendations/next` - Get next song recommendations
- `POST /api/v1/recommendations/feedback` - Submit listening feedback
- `GET /api/v1/recommendations/audio-features/{track_id}` - Get track features

### Sessions
- `POST /api/v1/sessions/start` - Start listening session
- `PUT /api/v1/sessions/{id}/end` - End session
- `POST /api/v1/sessions/{id}/transition` - Record song transition
- `GET /api/v1/sessions/{id}` - Get session details

---

## 🗄️ Database Schema

### Users
- `spotify_id`, `email`, `display_name`
- `mood_bias`, `avg_skip_rate`, `avg_session_length`
- `access_token`, `refresh_token`

### Songs
- `spotify_id`, `name`, `artist`, `album`
- Audio features: `energy`, `valence`, `danceability`, etc.
- `mood_vector` (computed)

### Sessions
- `user_id`, `started_at`, `ended_at`
- `mood_start`, `mood_end`, `mood_trajectory`
- `total_songs_played`, `total_songs_skipped`

### Transitions
- `from_song_id`, `to_song_id`
- `was_played_fully`, `was_skipped`, `was_liked`
- `reward` (for RL training)

---

## 🎯 Roadmap

### Phase 1: Core MVP (Current)
- ✅ Backend API setup
- ✅ Spotify integration
- ✅ Mood analysis engine
- ✅ RL agent implementation
- ⏳ PostgreSQL database setup
- ⏳ Frontend player UI
- ⏳ Mood visualization

### Phase 2: Enhancement
- [ ] User authentication with JWT
- [ ] Session persistence
- [ ] Historical mood analytics
- [ ] Playlist generation from mood arcs
- [ ] Social features (share mood flows)

### Phase 3: Mobile & Expansion
- [ ] Flutter mobile app (iOS + Android)
- [ ] Apple Music integration (optional)
- [ ] Offline mode
- [ ] Desktop app (Electron/Tauri)

---

## 🛠️ Development

### Run Backend Tests
```bash
cd backend
pytest
```

### Run Frontend Dev Mode
```bash
cd frontend
npm run dev
```

### Train RL Model
The model trains automatically as users interact, but you can:
```python
from ml.agents.music_rl_agent import rl_agent

# Save trained model
rl_agent.save_model('models/auralflow_v1.pt')

# Load pre-trained model
rl_agent.load_model('models/auralflow_v1.pt')
```

---

## 🤝 Contributing

This is your personal project, but if you want to collaborate later:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## 📝 License

[Choose your license - MIT, Apache 2.0, etc.]

---

## 🎵 Philosophy

> "Music is emotional, not categorical."

AuralFlow doesn't care if you jump from EDM to classical to Bollywood — it understands the **emotional thread** connecting your listening journey.

Built for people who don't just listen to music, but **live inside it**.

---

**Made with ❤️ and AI**
