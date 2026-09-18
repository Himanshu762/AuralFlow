from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
import os


class Settings(BaseSettings):
    """Application settings and configuration"""

    # Application
    APP_NAME: str = "AuralFlow"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"
    SECRET_KEY: str = "dev-secret-key-change-in-production"

    # Database — uses env DATABASE_URL if set, otherwise local SQLite
    DATABASE_URL: str = ""

    # Supabase (optional)
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""

    # Frontend
    FRONTEND_URL: str = "http://localhost:3000"

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:8000",
        "http://localhost:5173",  # Monochrome dev server
    ]

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="allow"
    )

    @property
    def effective_database_url(self) -> str:
        """Return the DB URL. Uses local SQLite for standalone mode."""
        # Standalone lightweight app — always use local SQLite
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "auralflow.db")
        return f"sqlite:///{db_path}"

    @property
    def is_sqlite(self) -> bool:
        return self.effective_database_url.startswith("sqlite")


settings = Settings()
