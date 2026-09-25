"""
Recommendation Service

Owns the RL agent's lifecycle (checkpoints, stats) and the two things the
shell asks of it directly: rank a list of candidates, and learn from how a
track was received. The DJ (`dj_service`) builds on the same agent to choose
what plays next from the library.
"""

import math
import os
from typing import Dict, List, Optional

_project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from sqlalchemy.orm import Session

from app.services.mood_service import mood_service
from app.services.track_service import track_service
from ml.agents.music_rl_agent import rl_agent


# Mood vectors are five dimensions each bounded to [0, 1], so the largest
# possible Euclidean separation between two of them is sqrt(5).
_MAX_MOOD_DISTANCE = math.sqrt(5)

# Where the agent's weights live between runs. Override with AURALFLOW_MODEL_PATH.
CHECKPOINT_PATH = os.environ.get(
    "AURALFLOW_MODEL_PATH",
    os.path.join(_project_root, "ml", "models", "music_rl_agent.pt"),
)

# A checkpoint every few feedback events keeps writes cheap but bounds loss.
SAVE_EVERY_N_FEEDBACKS = 5


class RecommendationService:
    def __init__(self) -> None:
        self._last_reward: Optional[float] = None
        self._writes_since_save: int = 0
        self.load_checkpoint()

    # ---------------------------------------------------------------- #
    # Checkpointing                                                     #
    # ---------------------------------------------------------------- #

    def load_checkpoint(self) -> bool:
        restored = rl_agent.load_model(CHECKPOINT_PATH)
        if restored:
            print(
                f"[rl_agent] resumed from {CHECKPOINT_PATH} "
                f"({rl_agent.training_steps} steps, {len(rl_agent.memory)} experiences, "
                f"eps={rl_agent.epsilon:.3f})"
            )
        return restored

    def save_checkpoint(self) -> None:
        try:
            rl_agent.save_model(CHECKPOINT_PATH)
            self._writes_since_save = 0
        except Exception as e:  # noqa: BLE001 — never fail a request over a save
            print(f"[rl_agent] could not write checkpoint: {e}")

    def stats(self) -> Dict:
        return {
            "exploration_rate": float(rl_agent.epsilon),
            "memory_size": len(rl_agent.memory),
            "training_steps": rl_agent.training_steps,
            "last_reward": self._last_reward,
            "checkpoint": CHECKPOINT_PATH if os.path.isfile(CHECKPOINT_PATH) else None,
        }

    # ---------------------------------------------------------------- #
    # Ranking                                                           #
    # ---------------------------------------------------------------- #

    def score_candidates(
        self,
        candidates: List[Dict],
        current_mood: List[float],
        recent_moods: List[List[float]],
        time_of_day: str = "afternoon",
        device_type: str = "web",
        num_recommendations: int = 10,
        target_mood: Optional[List[float]] = None,
        db: Optional[Session] = None,
    ) -> List[Dict]:
        """Rank candidate tracks the shell hands over (a search, a playlist)."""
        if not candidates:
            return []

        predicted_mood = target_mood or mood_service.predict_next_mood(
            recent_moods + [current_mood], transition_weight=0.3
        )

        enriched = track_service.compute_batch_moods(candidates, db)

        state = rl_agent.encode_state(
            current_mood=current_mood,
            recent_moods=recent_moods,
            time_of_day=time_of_day,
            device_type=device_type,
            target_mood=predicted_mood,
        )

        q_values = rl_agent.score_batch(state, [s["mood_vector"] for s in enriched])

        scored_songs = []
        for song, q_value in zip(enriched, q_values):
            distance = mood_service.compute_mood_distance(current_mood, song["mood_vector"])
            scored_songs.append(
                {
                    **song,
                    # Raw Q-value: ranks candidates, not a percentage.
                    "confidence": round(q_value, 4),
                    "mood_distance": round(distance, 4) if song["mood_known"] else None,
                    # Bounded 0..1 affinity to the listener's current mood.
                    # None when there was no mood to compare against.
                    "match": (
                        round(max(0.0, min(1.0, 1.0 - distance / _MAX_MOOD_DISTANCE)), 4)
                        if song["mood_known"]
                        else None
                    ),
                    "predicted_mood": predicted_mood,
                }
            )

        scored_songs.sort(key=lambda x: x["confidence"], reverse=True)
        return scored_songs[:num_recommendations]

    # ---------------------------------------------------------------- #
    # Learning                                                          #
    # ---------------------------------------------------------------- #

    def record_feedback(
        self,
        state: Dict,
        selected_song: Dict,
        feedback: Dict,
        next_state: Optional[Dict] = None,
        next_song: Optional[Dict] = None,
    ) -> Dict:
        """
        Record how a track was received and take a training step.

        `state` is the listener's situation when the track started;
        `next_state` is the situation when the following track started, and
        `next_song` that track's mood. With both, the update bootstraps from
        the transition the listener actually took.
        """
        current_state_vec = self._encode(state)
        action_mood = selected_song["mood_vector"]

        reward = rl_agent.compute_reward(
            was_played_fully=feedback.get("was_played_fully", False),
            was_skipped=feedback.get("was_skipped", False),
            was_liked=feedback.get("was_liked", False),
            was_replayed=feedback.get("was_replayed", False),
            play_duration_ratio=feedback.get("play_duration_ratio", 0.0),
        )

        if next_state:
            next_state_vec = self._encode(next_state)
            done = False
        else:
            next_state_vec = current_state_vec
            done = True

        rl_agent.store_experience(
            state=current_state_vec,
            action_song_mood=action_mood,
            reward=reward,
            next_state=next_state_vec,
            done=done,
            next_action_song_mood=(next_song or {}).get("mood_vector"),
        )

        loss = rl_agent.train_step(batch_size=32)
        self._last_reward = float(reward)

        self._writes_since_save += 1
        if self._writes_since_save >= SAVE_EVERY_N_FEEDBACKS:
            self.save_checkpoint()

        return {"reward": reward, "loss": loss, "epsilon": rl_agent.epsilon}

    @staticmethod
    def _encode(state: Dict):
        return rl_agent.encode_state(
            current_mood=state["current_mood"],
            recent_moods=state.get("recent_moods", []),
            time_of_day=state.get("time_of_day", "afternoon"),
            device_type=state.get("device_type", "web"),
            target_mood=state.get("target_mood"),
        )


recommendation_service = RecommendationService()
