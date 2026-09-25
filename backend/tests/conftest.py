"""Shared fixtures.

The RL agent is a module-level singleton, so tests that touch training must
isolate themselves from each other and from any checkpoint on disk. The
database is a throwaway SQLite file so tests never touch a real library.
"""

import os
import sys
import tempfile

import pytest

# The backend package and the ml package both hang off the repo root.
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ROOT = os.path.dirname(_BACKEND)
for path in (_BACKEND, _ROOT):
    if path not in sys.path:
        sys.path.insert(0, path)

# Must be set before anything imports app.core.config / app.db.base.
_TMP = tempfile.mkdtemp(prefix="auralflow-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(_TMP, 'test.db')}"
os.environ["AURALFLOW_MODEL_PATH"] = os.path.join(_TMP, "agent.pt")


@pytest.fixture
def agent():
    """A clean agent, restored to its starting state after the test."""
    from ml.agents.music_rl_agent import rl_agent

    saved = (
        rl_agent.epsilon,
        rl_agent.training_steps,
        list(rl_agent.memory),
    )
    rl_agent.memory.clear()
    rl_agent.training_steps = 0
    rl_agent.epsilon = 0.3

    yield rl_agent

    rl_agent.epsilon, rl_agent.training_steps, restored = saved
    rl_agent.memory.clear()
    for item in restored:
        rl_agent.memory.append(item)


@pytest.fixture
def db():
    """A database session on a fresh schema. Tables are emptied afterwards."""
    from app.db.base import SessionLocal, ensure_schema, engine, Base

    ensure_schema()
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        with engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                conn.execute(table.delete())


@pytest.fixture
def client(db):
    """FastAPI test client."""
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as c:
        yield c
