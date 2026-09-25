import os
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Settings(BaseSettings):
    """Application settings and configuration"""

    # Application
    APP_NAME: str = "AuralFlow"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"
    SECRET_KEY: str = "dev-secret-key-change-in-production"

    # Database. Empty means the local SQLite file beside the backend, which is
    # what a self-hosted install wants. Set DATABASE_URL to use anything else.
    DATABASE_URL: str = ""

    # Frontend
    FRONTEND_URL: str = "http://localhost:3000"

    # CORS
    #
    # The packaged desktop app does not serve the UI over http — the webview
    # origin is tauri://localhost on Linux and macOS, and http://tauri.localhost
    # on Windows. Both must be allowed or every call from the installed app is
    # blocked and the AI DJ silently reports itself offline.
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:8000",
        "http://localhost:5173",  # audio engine
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ]

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="allow")

    @property
    def effective_database_url(self) -> str:
        if self.DATABASE_URL.strip():
            return self.DATABASE_URL.strip()
        return f"sqlite:///{os.path.join(_BACKEND_ROOT, 'auralflow.db')}"

    @property
    def is_sqlite(self) -> bool:
        return self.effective_database_url.startswith("sqlite")


settings = Settings()
