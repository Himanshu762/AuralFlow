"""
Listening sessions and mood transitions.

AuralFlow is a single-user local app: the backend serves one listener on one
machine, so requests default to LOCAL_USER_ID rather than carrying a token.
Pass an explicit user_id if you run the backend for more than one listener.

Note: the desktop UI does not call these endpoints yet — it drives the agent
directly through /recommendations. They are here for session-level analytics.
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel
from datetime import datetime, timezone

from app.db.base import get_db
from app.models.session import Session as ListeningSession
from app.models.transition import Transition
from app.models.user import User

# The single local listener. Created on startup by app.main.
LOCAL_USER_ID = 1

router = APIRouter()


class SessionCreate(BaseModel):
    """Create a new listening session"""
    device_type: str = "web"
    time_of_day: str = "afternoon"
    mood_start: List[float]


class SessionUpdate(BaseModel):
    """Update session when it ends"""
    mood_end: List[float]
    mood_trajectory: List[List[float]]
    total_songs_played: int
    total_songs_skipped: int
    avg_energy: float
    avg_valence: float


class TransitionCreate(BaseModel):
    """Record a song transition"""
    from_song_id: str
    to_song_id: str
    was_played_fully: bool = False
    was_skipped: bool = False
    was_liked: bool = False
    was_replayed: bool = False
    play_duration_ms: int
    reward: float


@router.post("/start")
async def start_session(
    session_data: SessionCreate,
    user_id: int = LOCAL_USER_ID,
    db: Session = Depends(get_db)
):
    """
    Start a new listening session
    """
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Create new session
        session = ListeningSession(
            user_id=user_id,
            device_type=session_data.device_type,
            time_of_day=session_data.time_of_day,
            mood_start=session_data.mood_start,
            mood_trajectory=[session_data.mood_start]
        )

        db.add(session)
        db.commit()
        db.refresh(session)

        return {
            "session_id": session.id,
            "started_at": session.started_at,
            "status": "active"
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to start session: {str(e)}")


@router.put("/{session_id}/end")
async def end_session(
    session_id: int,
    session_data: SessionUpdate,
    user_id: int = LOCAL_USER_ID,
    db: Session = Depends(get_db)
):
    """
    End a listening session
    """
    try:
        session = db.query(ListeningSession).filter(
            ListeningSession.id == session_id,
            ListeningSession.user_id == user_id
        ).first()

        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Update session
        session.ended_at = datetime.now(timezone.utc)
        session.mood_end = session_data.mood_end
        session.mood_trajectory = session_data.mood_trajectory
        session.total_songs_played = session_data.total_songs_played
        session.total_songs_skipped = session_data.total_songs_skipped
        session.avg_energy = session_data.avg_energy
        session.avg_valence = session_data.avg_valence

        db.commit()

        started = session.started_at
        if started is not None and started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        duration_minutes = (
            (session.ended_at - started).total_seconds() / 60 if started is not None else 0.0
        )

        # Update user statistics
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            skip_rate = session.total_songs_skipped / max(session.total_songs_played, 1)

            # Update running averages
            user.avg_skip_rate = (user.avg_skip_rate * 0.9) + (skip_rate * 0.1)
            user.avg_session_length = (user.avg_session_length * 0.9) + (duration_minutes * 0.1)
            db.commit()

        return {
            "session_id": session.id,
            "duration_minutes": duration_minutes,
            "total_songs": session.total_songs_played,
            "status": "completed"
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to end session: {str(e)}")


@router.post("/{session_id}/transition")
async def record_transition(
    session_id: int,
    transition_data: TransitionCreate,
    user_id: int = LOCAL_USER_ID,
    db: Session = Depends(get_db)
):
    """
    Record a song transition (from one song to another)
    """
    try:
        session = db.query(ListeningSession).filter(
            ListeningSession.id == session_id,
            ListeningSession.user_id == user_id
        ).first()

        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Create transition record
        transition = Transition(
            session_id=session_id,
            user_id=user_id,
            from_song_id=transition_data.from_song_id,
            to_song_id=transition_data.to_song_id,
            was_played_fully=transition_data.was_played_fully,
            was_skipped=transition_data.was_skipped,
            was_liked=transition_data.was_liked,
            was_replayed=transition_data.was_replayed,
            play_duration_ms=transition_data.play_duration_ms,
            reward=transition_data.reward
        )

        db.add(transition)
        db.commit()
        db.refresh(transition)

        return {
            "transition_id": transition.id,
            "reward": transition.reward,
            "timestamp": transition.timestamp
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to record transition: {str(e)}")


@router.get("/{session_id}")
async def get_session(
    session_id: int,
    user_id: int = LOCAL_USER_ID,
    db: Session = Depends(get_db)
):
    """
    Get session details
    """
    session = db.query(ListeningSession).filter(
        ListeningSession.id == session_id,
        ListeningSession.user_id == user_id
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "id": session.id,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "mood_start": session.mood_start,
        "mood_end": session.mood_end,
        "mood_trajectory": session.mood_trajectory,
        "total_songs_played": session.total_songs_played,
        "total_songs_skipped": session.total_songs_skipped,
        "avg_energy": session.avg_energy,
        "avg_valence": session.avg_valence,
        "device_type": session.device_type,
        "time_of_day": session.time_of_day
    }


@router.get("/")
async def get_user_sessions(
    user_id: int = LOCAL_USER_ID,
    limit: int = 10,
    db: Session = Depends(get_db)
):
    """
    Get user's recent sessions
    """
    sessions = db.query(ListeningSession).filter(
        ListeningSession.user_id == user_id
    ).order_by(ListeningSession.started_at.desc()).limit(limit).all()

    return {
        "sessions": [
            {
                "id": s.id,
                "started_at": s.started_at,
                "ended_at": s.ended_at,
                "total_songs": s.total_songs_played,
                "device_type": s.device_type
            }
            for s in sessions
        ]
    }
