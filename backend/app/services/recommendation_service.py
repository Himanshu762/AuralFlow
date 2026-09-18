"""
Recommendation Service

Orchestrates the mood analysis and RL agent to rank candidate tracks.
The frontend sends candidate tracks (from Monochrome search results),
and this service scores and ranks them using the RL agent.
"""

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
import numpy as np
import torch


class RecommendationService:
    """
    Core recommendation engine that combines:
    1. Mood-based filtering (via heuristic mapper)
    2. RL-based ranking
    """

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
            combined = np.concatenate([state, song_mood])

            with torch.no_grad():
                combined_tensor = torch.FloatTensor(combined)
                q_value = rl_agent.policy_net(combined_tensor).item()

            scored_songs.append(
                {
                    **song,
                    "confidence": round(q_value, 4),
                    "mood_distance": round(
                        mood_service.compute_mood_distance(current_mood, song["mood_vector"]),
                        4,
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

        return {
            "reward": reward,
            "loss": loss,
            "epsilon": rl_agent.epsilon,
        }


recommendation_service = RecommendationService()
