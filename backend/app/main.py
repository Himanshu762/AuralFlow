from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.db.base import engine, Base

# Import all models so SQLAlchemy knows about them
from app.models import User, Song, Session, Transition  # noqa: F401

app = FastAPI(
    title=settings.APP_NAME,
    debug=settings.DEBUG,
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    """Create database tables on startup and ensure default user exists"""
    Base.metadata.create_all(bind=engine)

    # Auto-create default user so the app works out of the box
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


@app.get("/")
async def root():
    return {
        "message": "Welcome to AuralFlow API",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


# Include routers
from app.api.endpoints import auth, sessions, recommendations

app.include_router(auth.router, prefix=f"{settings.API_V1_PREFIX}/auth", tags=["auth"])
app.include_router(sessions.router, prefix=f"{settings.API_V1_PREFIX}/sessions", tags=["sessions"])
app.include_router(recommendations.router, prefix=f"{settings.API_V1_PREFIX}/recommendations", tags=["recommendations"])
