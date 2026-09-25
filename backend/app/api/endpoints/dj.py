"""
The DJ: what plays next, chosen from the library along a session arc.
"""

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.services import dj_service, library_service
from app.services.recommendation_service import recommendation_service
from ml.agents.music_rl_agent import rl_agent

router = APIRouter()


class NextRequest(BaseModel):
    current_mood: List[float]
    recent_moods: List[List[float]] = Field(default_factory=list)
    mode: str = "drift"
    custom_target: Optional[List[float]] = None
    position: int = 0
    horizon: int = 6
    current_track: Optional[Dict] = None
    exclude_ids: List[str] = Field(default_factory=list)
    time_of_day: str = "afternoon"
    device_type: str = "desktop"
    pool_limit: int = 300


class RejectRequest(BaseModel):
    track_id: str
    song_mood_vector: List[float]
    state: Dict


@router.post("/next")
async def next_track(request: NextRequest, db: Session = Depends(get_db)):
    exclude = set(request.exclude_ids)
    if request.current_track and request.current_track.get("id"):
        exclude.add(str(request.current_track["id"]))
    candidates = library_service.pool(db, limit=request.pool_limit, exclude_ids=exclude)
    result = dj_service.choose_next(
        candidates=candidates,
        current_mood=request.current_mood,
        recent_moods=request.recent_moods,
        mode=request.mode,
        custom_target=request.custom_target,
        position=request.position,
        horizon=request.horizon,
        current_track=request.current_track,
        time_of_day=request.time_of_day,
        device_type=request.device_type,
    )
    result["library"] = library_service.stats(db)
    return result


@router.post("/reject")
async def reject_pick(request: RejectRequest, db: Session = Depends(get_db)):
    """
    The listener turned a pick down before it played. That is a real signal
    — weaker than an early skip, since they never heard it, but negative.
    """
    state = rl_agent.encode_state(
        current_mood=request.state["current_mood"],
        recent_moods=request.state.get("recent_moods", []),
        time_of_day=request.state.get("time_of_day", "afternoon"),
        device_type=request.state.get("device_type", "desktop"),
        target_mood=request.state.get("target_mood"),
    )
    rl_agent.store_experience(
        state=state,
        action_song_mood=request.song_mood_vector,
        reward=-0.5,
        next_state=state,
        done=True,
    )
    loss = rl_agent.train_step(batch_size=32)
    library_service.record_outcome(db, request.track_id, reward=-0.5, skipped=True)
    return {"ok": True, "reward": -0.5, "training_loss": loss}


@router.get("/modes")
async def modes():
    return {
        "modes": [
            {"id": "hold", "label": "Hold", "hint": "Keep the mood where it is."},
            {"id": "drift", "label": "Drift", "hint": "Follow where the last few tracks were heading."},
            {"id": "lift", "label": "Lift", "hint": "Raise energy and brightness, one step a track."},
            {"id": "settle", "label": "Settle", "hint": "Wind down: less energy, more acoustic and instrumental."},
            {"id": "focus", "label": "Focus", "hint": "Mid-energy, instrumental, and stay there."},
            {"id": "custom", "label": "Custom", "hint": "Head toward a mood you set, over a few tracks."},
        ],
        "policy_weight": dj_service.policy_weight(),
        "exploration": recommendation_service.stats()["exploration_rate"],
    }
