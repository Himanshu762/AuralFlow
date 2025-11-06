from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class Transition(Base):
    __tablename__ = "transitions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Song transition
    from_song_id = Column(String, nullable=False)  # Spotify ID
    to_song_id = Column(String, nullable=False)  # Spotify ID

    # User feedback
    was_played_fully = Column(Boolean, default=False)
    was_skipped = Column(Boolean, default=False)
    was_liked = Column(Boolean, default=False)
    was_replayed = Column(Boolean, default=False)

    # Reward for RL
    reward = Column(Float, default=0.0)

    # Timing
    play_duration_ms = Column(Integer)  # How long the song was played
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    session = relationship("Session", back_populates="transitions")
