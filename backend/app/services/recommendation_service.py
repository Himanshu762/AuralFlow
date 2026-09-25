"""
Recommendation Service

Orchestrates the mood analysis and RL agent to rank candidate tracks.
The frontend sends candidate tracks (from Monochrome search results),
and this service scores and ranks them using the RL agent.
"""

import math
import os
import sys

# Add project root to path so ml package can be imported
_project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from typing import List, Dict, Optional
from app.services.track_service import track_service
from app.services.mood_service import mood_service
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
    """
    Core recommendation engine that combines:
    1. Mood-based filtering (via heuristic mapper)
    2. RL-based ranking
    """

    def __init__(self) -> None:
        # Last reward is a session figure; step counts live on the agent so
        # they survive restarts along with the weights.
        self._last_reward: Optional[float] = None
        self._writes_since_save: int = 0
        self.load_checkpoint()

    # ---------------------------------------------------------------- #
    # Checkpointing                                                     #
    # ---------------------------------------------------------------- #

    def load_checkpoint(self) -> bool:
        """Restore the agent from disk. Called once at construction."""
        restored = rl_agent.load_model(CHECKPOINT_PATH)
        if restored:
            print(
                f"[rl_agent] resumed from {CHECKPOINT_PATH} "
                f"({rl_agent.training_steps} steps, {len(rl_agent.memory)} experiences, "
                f"eps={rl_agent.epsilon:.3f})"
            )
        return restored

    def save_checkpoint(self) -> None:
        """Persist the agent. Safe to call often; writes are atomic."""
        try:
            rl_agent.save_model(CHECKPOINT_PATH)
            self._writes_since_save = 0
        except Exception as e:  # noqa: BLE001 — never fail a request over a save
            print(f"[rl_agent] could not write checkpoint: {e}")

    def stats(self) -> Dict:
        """Current training status of the RL agent."""
        return {
            "exploration_rate": float(rl_agent.epsilon),
            "memory_size": len(rl_agent.memory),
            "training_steps": rl_agent.training_steps,
            "last_reward": self._last_reward,
            "checkpoint": CHECKPOINT_PATH if os.path.isfile(CHECKPOINT_PATH) else None,
        }

    def score_candidates(
        self,
        candidates: List[Dict],
        current_mood: List[float],
        recent_moods: List[List[float]],
        time_of_day: str = "afternoon",
        device_type: str = "web",
        num_recommendations: int = 10,
    ) -> List[Dict]:
        """
        Score and rank candidate tracks sent by the frontend.

        Args:
            candidates: List of track dicts with at minimum {id, title, artist, genre}
            current_mood: Current mood vector [energy, valence, danceability, acousticness, instrumentalness]
            recent_moods: List of recent mood vectors
            time_of_day: morning, afternoon, evening, night
            device_type: web, mobile, desktop
            num_recommendations: Number of results to return

        Returns:
            Ranked list of tracks with confidence scores and mood data
        """
        if not candidates:
            return []

        # Step 1: Predict next mood direction
        predicted_mood = mood_service.predict_next_mood(
            recent_moods + [current_mood],
            transition_weight=0.3,
        )

        # Step 2: Compute mood vectors for all candidates
        enriched = track_service.compute_batch_moods(candidates)

        # Step 3: Encode the current state for the RL agent
        state = rl_agent.encode_state(
            current_mood=current_mood,
            recent_moods=recent_moods,
            time_of_day=time_of_day,
            device_type=device_type,
        )

        # Step 4: Score each candidate using the RL policy
        scored_songs = []
        for song in enriched:
            song_mood = song["mood_vector"]
            q_value = rl_agent.score(state, song_mood)

            distance = mood_service.compute_mood_distance(current_mood, song["mood_vector"])

            scored_songs.append(
                {
                    **song,
                    # Raw Q-value from the policy network. Unbounded and often
                    # negative before the agent has been trained — useful for
                    # ranking, but it is not a percentage.
                    "confidence": round(q_value, 4),
                    "mood_distance": round(distance, 4) if song["mood_known"] else None,
                    # A bounded 0..1 affinity the UI can show as a percentage:
                    # how close this track sits to the listener's current mood
                    # in the 5-D space (max separation is sqrt(5)).
                    #
                    # None when the track carried no genre to read a mood from.
                    # Its vector is then the neutral centre, which sits zero
                    # distance from every mood and would report as a perfect
                    # match for everything — the agent still ranks it by
                    # Q-value, but there is no affinity to show.
                    "match": (
                        round(max(0.0, min(1.0, 1.0 - distance / _MAX_MOOD_DISTANCE)), 4)
                        if song["mood_known"]
                        else None
                    ),
                    "predicted_mood": predicted_mood,
                }
            )

        # Sort by confidence (Q-value) descending
        scored_songs.sort(key=lambda x: x["confidence"], reverse=True)

        return scored_songs[:num_recommendations]

    def record_feedback(
        self,
        state: Dict,
        selected_song: Dict,
        feedback: Dict,
        next_state: Optional[Dict] = None,
    ) -> Dict:
        """
        Record user feedback and train the RL agent.

        Args:
            state: Previous state (mood, context)
            selected_song: The song that was played
            feedback: User feedback (played_fully, skipped, liked, etc.)
            next_state: New state after the song
        """
        # Encode state
        current_state_vec = rl_agent.encode_state(
            current_mood=state["current_mood"],
            recent_moods=state.get("recent_moods", []),
            time_of_day=state.get("time_of_day", "afternoon"),
            device_type=state.get("device_type", "web"),
        )

        # Song action
        action_mood = selected_song["mood_vector"]

        # Compute reward
        reward = rl_agent.compute_reward(
            was_played_fully=feedback.get("was_played_fully", False),
            was_skipped=feedback.get("was_skipped", False),
            was_liked=feedback.get("was_liked", False),
            was_replayed=feedback.get("was_replayed", False),
            play_duration_ratio=feedback.get("play_duration_ratio", 0.0),
        )

        # Next state
        if next_state:
            next_state_vec = rl_agent.encode_state(
                current_mood=next_state["current_mood"],
                recent_moods=next_state.get("recent_moods", []),
                time_of_day=next_state.get("time_of_day", "afternoon"),
                device_type=next_state.get("device_type", "web"),
            )
            done = False
        else:
            next_state_vec = current_state_vec
            done = True

        # Store experience
        rl_agent.store_experience(
            state=current_state_vec,
            action_song_mood=action_mood,
            reward=reward,
            next_state=next_state_vec,
            done=done,
        )

        # Train the agent
        loss = rl_agent.train_step(batch_size=32)

        self._last_reward = float(reward)

        # Persist periodically so a crash costs at most a few tracks of
        # learning, rather than the whole session.
        self._writes_since_save += 1
        if self._writes_since_save >= SAVE_EVERY_N_FEEDBACKS:
            self.save_checkpoint()

        return {
            "reward": reward,
            "loss": loss,
            "epsilon": rl_agent.epsilon,
        }


recommendation_service = RecommendationService()
