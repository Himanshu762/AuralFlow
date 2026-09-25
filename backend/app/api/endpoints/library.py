"""
The listener's library: what the DJ chooses from.

The shell reports every track it comes across and every measurement the
engine takes; the backend keeps them, so the candidate pool outlives a search
box and a session.
"""

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.services import library_service

router = APIRouter()


class LibraryTrack(BaseModel):
    id: str
    title: str = ""
    artist: str = ""
    artistId: Optional[str] = None
    album: Optional[str] = ""
    albumId: Optional[str] = None
    genre: Optional[str] = ""
    duration: Optional[float] = 0
    cover: Optional[str] = ""
    coverLarge: Optional[str] = ""
    audioQuality: Optional[str] = ""
    audioModes: Optional[List[str]] = None


class UpsertRequest(BaseModel):
    tracks: List[LibraryTrack]
    source: str = "search"


class FeaturesRequest(BaseModel):
    track_id: str
    seconds: float = 0
    features: Dict = Field(default_factory=dict)
    final: bool = False


class EventRequest(BaseModel):
    track_id: str
    event: str  # play | like | unlike


@router.post("/tracks")
async def upsert_tracks(request: UpsertRequest, db: Session = Depends(get_db)):
    count = library_service.upsert_tracks(db, [t.model_dump() for t in request.tracks], request.source)
    return {"stored": count, "stats": library_service.stats(db)}


@router.post("/features")
async def store_features(request: FeaturesRequest, db: Session = Depends(get_db)):
    """What the engine measured from the audio while a track played."""
    song = library_service.store_features(db, request.track_id, request.features, request.seconds)
    if song is None:
        return {"stored": False, "reason": "unknown track"}
    resolved = library_service.resolve_mood(db, {"id": song.track_id, "artist": song.artist, "genre": song.genre})
    return {"stored": True, "track_id": song.track_id, **resolved}


@router.post("/event")
async def record_event(request: EventRequest, db: Session = Depends(get_db)):
    if request.event == "play":
        library_service.record_play(db, request.track_id)
    elif request.event == "like":
        library_service.set_liked(db, request.track_id, True)
    elif request.event == "unlike":
        library_service.set_liked(db, request.track_id, False)
    else:
        return {"ok": False, "reason": f"unknown event {request.event}"}
    return {"ok": True}


@router.get("/pool")
async def get_pool(limit: int = 200, db: Session = Depends(get_db)):
    return {"tracks": library_service.pool(db, limit=limit), "stats": library_service.stats(db)}


@router.get("/stats")
async def get_stats(db: Session = Depends(get_db)):
    return library_service.stats(db)
