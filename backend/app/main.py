from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.base import ensure_schema

# Import all models so SQLAlchemy knows about them
from app.models import User, Song, Session, Transition  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables and the local user on the way up; checkpoint on the way down."""
    ensure_schema()

    from app.db.base import SessionLocal
    from app.models.user import User

    db = SessionLocal()
    try:
        default_user = db.query(User).filter(User.email == "local@auralflow.local").first()
        if not default_user:
            db.add(User(email="local@auralflow.local", display_name="Local Audiophile"))
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()

    yield

    # Persist what the agent learned this session.
    from app.services.recommendation_service import recommendation_service

    recommendation_service.save_checkpoint()


app = FastAPI(
    title=settings.APP_NAME,
    debug=settings.DEBUG,
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "Welcome to AuralFlow API", "version": "1.1.0", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


from app.api.endpoints import auth, dj, library, recommendations, sessions  # noqa: E402

app.include_router(auth.router, prefix=f"{settings.API_V1_PREFIX}/auth", tags=["auth"])
app.include_router(sessions.router, prefix=f"{settings.API_V1_PREFIX}/sessions", tags=["sessions"])
app.include_router(
    recommendations.router, prefix=f"{settings.API_V1_PREFIX}/recommendations", tags=["recommendations"]
)
app.include_router(library.router, prefix=f"{settings.API_V1_PREFIX}/library", tags=["library"])
app.include_router(dj.router, prefix=f"{settings.API_V1_PREFIX}/dj", tags=["dj"])
