from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Session metadata
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True))

    # Mood tracking
    mood_start = Column(JSON)  # Starting mood vector
    mood_end = Column(JSON)  # Ending mood vector
    mood_trajectory = Column(JSON)  # Array of mood states over time

    # Session stats
    total_songs_played = Column(Integer, default=0)
    total_songs_skipped = Column(Integer, default=0)
    avg_energy = Column(Float, default=0.0)
    avg_valence = Column(Float, default=0.0)

    # Device and context
    device_type = Column(String)  # web, mobile, desktop
    time_of_day = Column(String)  # morning, afternoon, evening, night

    # Relationships
    user = relationship("User", back_populates="sessions")
    transitions = relationship("Transition", back_populates="session")
