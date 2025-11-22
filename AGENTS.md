# Repository Guidelines

## Project Structure & Module Organization
AuralFlow splits into `backend/` (FastAPI `app/` with `api/endpoints`, `services`, `models`, `schemas`, `db`, and Alembic), `frontend/` (Next.js `app/`, reusable `components/`, static `public/`), `ml/` (agents, models, utils), and `docs/`. `.env` templates live beside their targets (`backend/.env.example`, `frontend/.env.local`); keep reusable logic in services or ML helpers so routers stay thin and UI modules stay declarative.

## Build, Test, and Development Commands
- `cd backend && source venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
- `cd backend && source venv/bin/activate && alembic upgrade head`
- `cd backend && source venv/bin/activate && pytest`
- `cd frontend && npm install` once, then `npm run dev`, `npm run build`, `npm run lint`
- `python3 -m ml.agents.music_rl_agent` (persist checkpoints in `ml/models/`)

## Coding Style & Naming Conventions
Python modules use 4-space indentation, type hints on public APIs, and snake_case filenames (`spotify_service.py`). Keep routers under `app/api/endpoints`, Pydantic schemas in `app/schemas`, SQLAlchemy models in `app/models`, and settings/constants in `app/core`. Frontend files follow Next.js defaults: PascalCase components in `components/`, camelCase hooks/utilities, Tailwind classes grouped by layout → color → state. Run `npm run lint`, rely on Prettier, and keep TS/TSX strings double-quoted to match existing files.

## Testing Guidelines
Backend changes must ship with pytest modules named `test_<feature>.py` under `backend/tests/` mirroring the package tree. Use FastAPI’s `TestClient` or `httpx.AsyncClient` for API coverage, and mark expensive RL specs with `@pytest.mark.slow` so `pytest -m "not slow"` stays fast. Frontend work should at minimum keep ESLint clean; once component tests are added, colocate them in `frontend/__tests__/` with React Testing Library. Target ≥80% coverage on new services and explain any exceptions in the PR description.

## Commit & Pull Request Guidelines
Keep commits small, imperative, and scoped (`feat(api): add session transitions`). Reference issues in the body (`Refs #123`) and call out migrations or env changes explicitly. Pull requests should summarize behavior, attach test evidence (`pytest`, `npm run lint`, screenshots for UI), note schema/config updates, and describe rollback expectations for ML or Spotify-auth changes.

## Security & Configuration Tips
Never commit `.env`, tokens, database dumps, or trained weights with real listener data. Use the provided templates, rotate Spotify credentials regularly, reserve `NEXT_PUBLIC_*` variables for values safe to expose, and sanitize logs containing access or refresh tokens before sharing them in any discussion.
