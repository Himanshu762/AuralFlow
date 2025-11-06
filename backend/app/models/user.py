from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    spotify_id = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True)
    display_name = Column(String)

    # User behavior traits
    mood_bias = Column(Float, default=0.0)  # Overall mood tendency
    avg_skip_rate = Column(Float, default=0.0)  # Average skip rate
    avg_session_length = Column(Float, default=0.0)  # In minutes

    # Spotify tokens
    access_token = Column(String)
    refresh_token = Column(String)
    token_expires_at = Column(DateTime(timezone=True))

    # Metadata
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    sessions = relationship("Session", back_populates="user")
