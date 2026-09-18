from sqlalchemy import Column, Integer, String, Float, JSON
from app.db.base import Base


class Song(Base):
    __tablename__ = "songs"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(String, unique=True, index=True, nullable=False)

    # Song metadata
    name = Column(String, nullable=False)
    artist = Column(String, nullable=False)
    album = Column(String)
    genre = Column(String)
    duration_ms = Column(Integer)

    # Audio features (heuristically derived from genre)
    energy = Column(Float)  # 0.0 to 1.0
    valence = Column(Float)  # 0.0 to 1.0 (happiness/positivity)
    danceability = Column(Float)  # 0.0 to 1.0
    acousticness = Column(Float)  # 0.0 to 1.0
    instrumentalness = Column(Float)  # 0.0 to 1.0

    # Computed mood vector
    mood_vector = Column(JSON)  # Stored as JSON array
