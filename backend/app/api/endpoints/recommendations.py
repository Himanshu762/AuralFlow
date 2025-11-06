from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List, Dict, Optional
from pydantic import BaseModel

from app.db.base import get_db
from app.models.user import User
from app.services.spotify_service import spotify_service
from app.services.recommendation_service import recommendation_service

router = APIRouter()


class RecommendationRequest(BaseModel):
    """Request body for getting recommendations"""
    current_mood: List[float]  # [energy, valence, danceability, acousticness, instrumentalness]
    recent_songs: List[Dict]  # [{spotify_id, name, artist}]
    recent_moods: List[List[float]]  # Recent mood vectors
    time_of_day: Optional[str] = "afternoon"
    device_type: Optional[str] = "web"
    num_recommendations: Optional[int] = 10


class FeedbackRequest(BaseModel):
    """User feedback on a played song"""
    song_spotify_id: str
    song_mood_vector: List[float]
    state: Dict  # Current state when song was played
    was_played_fully: bool = False
    was_skipped: bool = False
    was_liked: bool = False
    was_replayed: bool = False
    play_duration_ms: int = 0
    total_duration_ms: int = 1


@router.post("/next")
async def get_next_recommendations(
    request: RecommendationRequest,
    user_id: int = 1,  # TODO: Get from JWT auth
    db: Session = Depends(get_db)
):
    """
    Get next song recommendations based on current mood flow

    This is the core endpoint that powers the AI DJ
    """
    try:
        # Get user
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Check if token is valid
        # TODO: Add token refresh logic if expired

        # Get Spotify client
        sp = spotify_service.get_client(user.access_token)

        # Get recommendations
        recommendations = recommendation_service.get_next_songs(
            spotify_client=sp,
            current_mood=request.current_mood,
            recent_songs=request.recent_songs,
            recent_moods=request.recent_moods,
            time_of_day=request.time_of_day,
            device_type=request.device_type,
            num_recommendations=request.num_recommendations
        )

        return {
            "recommendations": recommendations,
            "predicted_mood": recommendations[0]['mood_vector'] if recommendations else None,
            "count": len(recommendations)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get recommendations: {str(e)}")


@router.post("/feedback")
async def submit_feedback(
    feedback: FeedbackRequest,
    user_id: int = 1,  # TODO: Get from JWT auth
    db: Session = Depends(get_db)
):
    """
    Submit feedback on a played song

    This trains the RL agent to learn user preferences
    """
    try:
        # Calculate play duration ratio
        play_duration_ratio = feedback.play_duration_ms / max(feedback.total_duration_ms, 1)

        # Record feedback and train RL agent
        training_result = recommendation_service.record_feedback(
            state=feedback.state,
            selected_song={'mood_vector': feedback.song_mood_vector},
            feedback={
                'was_played_fully': feedback.was_played_fully,
                'was_skipped': feedback.was_skipped,
                'was_liked': feedback.was_liked,
                'was_replayed': feedback.was_replayed,
                'play_duration_ratio': play_duration_ratio
            }
        )

        return {
            "success": True,
            "reward": training_result['reward'],
            "training_loss": training_result['loss'],
            "exploration_rate": training_result['epsilon']
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to submit feedback: {str(e)}")


@router.get("/audio-features/{track_id}")
async def get_audio_features(
    track_id: str,
    user_id: int = 1,  # TODO: Get from JWT auth
    db: Session = Depends(get_db)
):
    """
    Get audio features for a specific track
    """
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        sp = spotify_service.get_client(user.access_token)
        features = spotify_service.get_audio_features(sp, track_id)

        if not features:
            raise HTTPException(status_code=404, detail="Track not found")

        from app.services.mood_service import mood_service
        mood_vector = mood_service.compute_mood_vector(features)
        mood_label = mood_service.get_mood_label(mood_vector)

        return {
            "track_id": track_id,
            "audio_features": features,
            "mood_vector": mood_vector,
            "mood_label": mood_label
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get audio features: {str(e)}")
