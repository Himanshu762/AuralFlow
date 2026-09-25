from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List, Dict, Optional
from pydantic import BaseModel

from app.db.base import get_db
from app.services.recommendation_service import recommendation_service

router = APIRouter()


class CandidateTrack(BaseModel):
    """A track from the frontend (Monochrome search result)"""
    id: str
    title: str
    artist: str
    genre: Optional[str] = ""
    album: Optional[str] = ""
    duration: Optional[float] = 0  # seconds
    cover_url: Optional[str] = ""
    stream_url: Optional[str] = ""


class ScoreRequest(BaseModel):
    """Request body for scoring candidate tracks"""
    candidates: List[CandidateTrack]
    current_mood: List[float]  # [energy, valence, danceability, acousticness, instrumentalness]
    recent_moods: List[List[float]] = []
    time_of_day: Optional[str] = "afternoon"
    device_type: Optional[str] = "web"
    num_recommendations: Optional[int] = 10


class FeedbackRequest(BaseModel):
    """User feedback on a played song"""
    track_id: str
    song_mood_vector: List[float]
    state: Dict  # Current state when song was played
    was_played_fully: bool = False
    was_skipped: bool = False
    was_liked: bool = False
    was_replayed: bool = False
    play_duration_ms: int = 0
    total_duration_ms: int = 1


class MoodRequest(BaseModel):
    """Request to compute mood for a single track"""
    id: str
    title: str
    artist: str
    genre: Optional[str] = ""


@router.post("/score")
async def score_candidates(request: ScoreRequest):
    """
    Score and rank candidate tracks using the RL agent.

    The frontend sends Monochrome search results here, and the backend
    returns them ranked by the AI DJ's confidence score.
    """
    try:
        candidates_dicts = [c.model_dump() for c in request.candidates]

        scored = recommendation_service.score_candidates(
            candidates=candidates_dicts,
            current_mood=request.current_mood,
            recent_moods=request.recent_moods,
            time_of_day=request.time_of_day,
            device_type=request.device_type,
            num_recommendations=request.num_recommendations,
        )

        return {
            "recommendations": scored,
            "predicted_mood": scored[0]["predicted_mood"] if scored else None,
            "count": len(scored),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to score candidates: {str(e)}")


@router.post("/feedback")
async def submit_feedback(feedback: FeedbackRequest):
    """
    Submit feedback on a played song.
    This trains the RL agent to learn user preferences.
    """
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
async def compute_mood(track: MoodRequest):
    """
    Compute the mood vector for a single track based on its genre.
    """
    from app.services.track_service import track_service

    result = track_service.compute_track_mood(track.model_dump())
    return {
        "track_id": result["id"],
        "mood_vector": result["mood_vector"],
        "mood_label": result["mood_label"],
    }


@router.get("/stats")
async def agent_stats():
    """
    Current training status of the RL agent.

    The desktop sidebar polls this to show exploration rate, replay-buffer
    size and how many gradient steps the agent has taken this session.
    """
    return recommendation_service.stats()
