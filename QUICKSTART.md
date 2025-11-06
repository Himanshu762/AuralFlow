# 🚀 AuralFlow Quick Start Guide

Get AuralFlow up and running in **10 minutes**.

---

## ⚡ Prerequisites Check

Before starting, ensure you have:

- [ ] **Python 3.13+** installed (`python3 --version`)
- [ ] **Node.js 18+** installed (`node --version`)
- [ ] **PostgreSQL 14+** installed and running
- [ ] **Spotify Developer credentials** (Client ID & Secret)

---

## 📋 Step-by-Step Setup

### 1️⃣ Clone & Navigate

```bash
cd /Users/anonymouse/AuralFlow
```

---

### 2️⃣ PostgreSQL Database Setup

**Option A: Using createdb (Mac/Linux)**
```bash
# Create the database
createdb auralflow_db

# Or with a specific user
createdb -U postgres auralflow_db
```

**Option B: Using psql**
```bash
psql -U postgres
CREATE DATABASE auralflow_db;
\q
```

**Create a database user (optional but recommended):**
```bash
psql -U postgres
CREATE USER auralflow WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE auralflow_db TO auralflow;
\q
```

---

### 3️⃣ Backend Configuration

```bash
cd backend

# Activate virtual environment (already created)
source venv/bin/activate

# Copy environment template
cp .env.example .env
```

**Edit `.env` with your credentials:**

```bash
nano .env  # or use your preferred editor
```

**Required settings:**
```env
# Spotify (REPLACE WITH YOUR CREDENTIALS)
SPOTIFY_CLIENT_ID=your_actual_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_actual_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/api/auth/callback

# Database (adjust if you used different credentials)
DATABASE_URL=postgresql://auralflow:your_password@localhost:5432/auralflow_db

# Security (generate a random secret)
SECRET_KEY=your_super_secret_key_here_change_this_in_production

# Other settings (can keep defaults)
FRONTEND_URL=http://localhost:3000
DEBUG=True
```

**Generate a SECRET_KEY:**
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

---

### 4️⃣ Run Database Migrations

```bash
cd /Users/anonymouse/AuralFlow/backend
source venv/bin/activate

# Create initial migration
alembic revision --autogenerate -m "Initial schema"

# Apply migrations
alembic upgrade head
```

If you see errors, ensure:
1. PostgreSQL is running
2. Database exists
3. DATABASE_URL in `.env` is correct

---

### 5️⃣ Start the Backend

```bash
cd /Users/anonymouse/AuralFlow/backend
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Test it:**
- Open: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Health check: http://localhost:8000/health

You should see:
```json
{
  "message": "Welcome to AuralFlow API",
  "version": "1.0.0",
  "status": "running"
}
```

---

### 6️⃣ Configure Frontend Environment

```bash
cd /Users/anonymouse/AuralFlow/frontend

# Create environment file
touch .env.local
```

**Add to `.env.local`:**
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=your_spotify_client_id
```

---

### 7️⃣ Start the Frontend

```bash
cd /Users/anonymouse/AuralFlow/frontend
npm run dev
```

**Test it:**
- Open: http://localhost:3000

---

### 8️⃣ Spotify Developer Setup

1. **Go to:** https://developer.spotify.com/dashboard
2. **Log in** with your Spotify account
3. **Create an App:**
   - Click "Create App"
   - Name: `AuralFlow`
   - Description: `AI-powered music flow player`
   - Redirect URI: `http://localhost:3000/api/auth/callback`
   - Check "Web API"
   - Click "Save"
4. **Get Credentials:**
   - Click "Settings"
   - Copy **Client ID** and **Client Secret**
   - Add them to `backend/.env`

---

## ✅ Verification Checklist

Backend running?
```bash
curl http://localhost:8000/health
# Should return: {"status":"healthy"}
```

Frontend running?
```bash
curl http://localhost:3000
# Should return HTML
```

Database connected?
```bash
cd backend
source venv/bin/activate
python3 -c "from app.db.base import engine; print(engine.connect())"
# Should connect without errors
```

API endpoints working?
```bash
curl http://localhost:8000/docs
# Should show Swagger UI
```

---

## 🎯 Next Steps

Once everything is running:

1. **Test Spotify Auth:**
   - Visit: http://localhost:8000/api/v1/auth/login
   - Should return a Spotify authorization URL

2. **Explore API Docs:**
   - Visit: http://localhost:8000/docs
   - Try the interactive API endpoints

3. **Build the Frontend:**
   - Start creating the player UI
   - Integrate Spotify Web Playback SDK
   - Add mood visualization

---

## 🐛 Common Issues

### "Database connection failed"
**Fix:**
```bash
# Check if PostgreSQL is running
brew services list  # Mac
sudo systemctl status postgresql  # Linux

# Start PostgreSQL
brew services start postgresql  # Mac
sudo systemctl start postgresql  # Linux
```

### "Module not found"
**Fix:**
```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
```

### "Spotify authentication error"
**Fix:**
- Verify Client ID and Secret in `.env`
- Check redirect URI in Spotify Dashboard matches exactly
- Ensure you've added `http://localhost:3000/api/auth/callback`

### "Port already in use"
**Fix:**
```bash
# Kill process on port 8000
lsof -ti:8000 | xargs kill -9

# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

---

## 📚 Learn More

- **Full README:** `README.md`
- **API Documentation:** http://localhost:8000/docs (when backend is running)
- **Backend Code:** `backend/app/`
- **ML Agent:** `ml/agents/music_rl_agent.py`
- **Spotify API Docs:** https://developer.spotify.com/documentation/web-api

---

## 🎉 You're Ready!

Your AuralFlow development environment is set up and ready to build the future of music listening!

**Happy coding! 🎵**
