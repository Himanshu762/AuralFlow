from sqlalchemy import Boolean, Column, DateTime, Float, Integer, JSON, String
from sqlalchemy.sql import func

from app.db.base import Base


class Song(Base):
    """
    Every track the listener has come across, and what we know about it.

    This is the DJ's candidate pool. Tracks arrive from search results, plays,
    imported playlists and artist/album lookups; the mood columns fill in as
    the engine measures the audio while it plays.
    """

    __tablename__ = "songs"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(String, unique=True, index=True, nullable=False)

    # Catalogue metadata
    name = Column(String, nullable=False)
    artist = Column(String, nullable=False, index=True)
    artist_id = Column(String)
    album = Column(String)
    album_id = Column(String)
    genre = Column(String)
    duration_ms = Column(Integer)
    cover = Column(String)
    cover_large = Column(String)
    audio_quality = Column(String)
    audio_modes = Column(JSON)

    # Where we first met the track: search, play, import, artist, album
    source = Column(String)
    first_seen_at = Column(DateTime(timezone=True), server_default=func.now())

    # Mood vector [energy, valence, danceability, acousticness, instrumentalness]
    energy = Column(Float)
    valence = Column(Float)
    danceability = Column(Float)
    acousticness = Column(Float)
    instrumentalness = Column(Float)
    mood_vector = Column(JSON)
    # measured | artist | genre | unknown — where the vector came from
    mood_source = Column(String, default="unknown")
    mood_confidence = Column(Float, default=0.0)

    # Raw features measured from the audio by the engine bridge
    features = Column(JSON)
    analysis_seconds = Column(Float, default=0.0)
    analysed_at = Column(DateTime(timezone=True))

    # Listening history, for novelty and recency in the DJ's ranking
    play_count = Column(Integer, default=0)
    skip_count = Column(Integer, default=0)
    liked = Column(Boolean, default=False)
    last_played_at = Column(DateTime(timezone=True))
    reward_total = Column(Float, default=0.0)
    reward_count = Column(Integer, default=0)
