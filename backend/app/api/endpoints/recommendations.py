from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.services import library_service
from app.services.recommendation_service import recommendation_service
from app.services.track_service import track_service

router = APIRouter()


class CandidateTrack(BaseModel):
    """A track from the frontend (a search result, a playlist entry)"""
    id: str
    title: str
    artist: str
    genre: Optional[str] = ""
    album: Optional[str] = ""
    duration: Optional[float] = 0  # seconds
    cover_url: Optional[str] = ""
    stream_url: Optional[str] = ""


class ScoreRequest(BaseModel):
    candidates: List[CandidateTrack]
    current_mood: List[float]  # [energy, valence, danceability, acousticness, instrumentalness]
    recent_moods: List[List[float]] = []
    target_mood: Optional[List[float]] = None
    time_of_day: Optional[str] = "afternoon"
    device_type: Optional[str] = "web"
    num_recommendations: Optional[int] = 10


class FeedbackRequest(BaseModel):
    """How a played song was received."""
    track_id: str
    song_mood_vector: List[float]
    state: Dict  # listener state when the song started
    next_state: Optional[Dict] = None  # listener state when the next song started
    next_song_mood_vector: Optional[List[float]] = None
    was_played_fully: bool = False
    was_skipped: bool = False
    was_liked: bool = False
    was_replayed: bool = False
    play_duration_ms: int = 0
    total_duration_ms: int = 1


class MoodRequest(BaseModel):
    id: str
    title: str
    artist: str
    genre: Optional[str] = ""


@router.post("/score")
async def score_candidates(request: ScoreRequest, db: Session = Depends(get_db)):
    """Score and rank candidate tracks the shell hands over."""
    try:
        candidates_dicts = [c.model_dump() for c in request.candidates]
        scored = recommendation_service.score_candidates(
            candidates=candidates_dicts,
            current_mood=request.current_mood,
            recent_moods=request.recent_moods,
            time_of_day=request.time_of_day,
            device_type=request.device_type,
            num_recommendations=request.num_recommendations,
            target_mood=request.target_mood,
            db=db,
        )
        return {
            "recommendations": scored,
            "predicted_mood": scored[0]["predicted_mood"] if scored else None,
            "count": len(scored),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to score candidates: {str(e)}")


@router.post("/feedback")
async def submit_feedback(feedback: FeedbackRequest, db: Session = Depends(get_db)):
    """Train the agent on how a track was received."""
    try:
        play_duration_ratio = feedback.play_duration_ms / max(feedback.total_duration_ms, 1)

        training_result = recommendation_service.record_feedback(
            state=feedback.state,
            selected_song={"mood_vector": feedback.song_mood_vector},
            feedback={
                "was_played_fully": feedback.was_played_fully,
                "was_skipped": feedback.was_skipped,
                "was_liked": feedback.was_liked,
                "was_replayed": feedback.was_replayed,
                "play_duration_ratio": play_duration_ratio,
            },
            next_state=feedback.next_state,
            next_song={"mood_vector": feedback.next_song_mood_vector} if feedback.next_song_mood_vector else None,
        )
        library_service.record_outcome(
            db, feedback.track_id, reward=training_result["reward"], skipped=feedback.was_skipped
        )
        return {
            "success": True,
            "reward": training_result["reward"],
            "training_loss": training_result["loss"],
            "exploration_rate": training_result["epsilon"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to submit feedback: {str(e)}")


@router.post("/mood")
async def compute_mood(track: MoodRequest, db: Session = Depends(get_db)):
    """
    The best mood reading for one track: measured from its audio if the
    engine has heard it, an artist prior if not, the genre table otherwise.
    """
    result = track_service.compute_track_mood(track.model_dump(), db)
    return {
        "track_id": result["id"],
        "mood_vector": result["mood_vector"],
        "mood_label": result["mood_label"],
        "mood_source": result["mood_source"],
        "mood_confidence": result["mood_confidence"],
        "measured": result.get("measured"),
    }


@router.get("/stats")
async def agent_stats():
    """Current training status of the RL agent."""
    return recommendation_service.stats()
