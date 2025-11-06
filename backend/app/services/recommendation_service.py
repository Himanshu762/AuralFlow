"""
Recommendation Service

Orchestrates the mood analysis, RL agent, and Spotify API
to generate intelligent song recommendations
"""

import sys
sys.path.append('/Users/anonymouse/AuralFlow/ml')

from typing import List, Dict, Optional
from app.services.spotify_service import spotify_service
from app.services.mood_service import mood_service
from ml.agents.music_rl_agent import rl_agent
import spotipy
import numpy as np


class RecommendationService:
    """
    Core recommendation engine that combines:
    1. Spotify recommendations
    2. Mood-based filtering
    3. RL-based ranking
    """

    def get_next_songs(
        self,
        spotify_client: spotipy.Spotify,
        current_mood: List[float],
        recent_songs: List[Dict],
        recent_moods: List[List[float]],
        time_of_day: str = "afternoon",
        device_type: str = "web",
        num_recommendations: int = 10
    ) -> List[Dict]:
        """
        Get the next recommended songs based on mood flow

        Args:
            spotify_client: Authenticated Spotify client
            current_mood: Current mood vector [energy, valence, ...]
            recent_songs: List of recently played songs with Spotify IDs
            recent_moods: List of recent mood vectors
            time_of_day: morning, afternoon, evening, night
            device_type: web, mobile, desktop
            num_recommendations: Number of songs to return

        Returns:
            List of recommended songs with metadata and confidence scores
        """

        # Step 1: Predict next mood direction
        predicted_mood = mood_service.predict_next_mood(
            recent_moods + [current_mood],
            transition_weight=0.3
        )

        # Step 2: Get Spotify recommendations based on predicted mood
        seed_tracks = [song['spotify_id'] for song in recent_songs[-3:]] if recent_songs else None

        candidates = spotify_service.get_recommendations(
            spotify_client=spotify_client,
            seed_tracks=seed_tracks,
            target_energy=predicted_mood[0],
            target_valence=predicted_mood[1],
            target_danceability=predicted_mood[2],
            limit=50  # Get more candidates for RL to rank
        )

        if not candidates:
            return []

        # Step 3: Get audio features and compute mood vectors for candidates
        candidate_songs_with_moods = []
        for song in candidates:
            audio_features = spotify_service.get_audio_features(
                spotify_client,
                song['id']
            )

            if audio_features:
                mood_vector = mood_service.compute_mood_vector(audio_features)
                mood_label = mood_service.get_mood_label(mood_vector)

                candidate_songs_with_moods.append({
                    'spotify_id': song['id'],
                    'name': song['name'],
                    'artist': song['artist'],
                    'uri': song['uri'],
                    'mood_vector': mood_vector,
                    'mood_label': mood_label,
                    'audio_features': audio_features
                })

        if not candidate_songs_with_moods:
            return []

        # Step 4: Use RL agent to rank candidates
        state = rl_agent.encode_state(
            current_mood=current_mood,
            recent_moods=recent_moods,
            time_of_day=time_of_day,
            device_type=device_type
        )

        # Score each candidate using the RL policy
        scored_songs = []
        for song in candidate_songs_with_moods:
            # Get Q-value from RL agent
            song_mood = song['mood_vector']
            combined = np.concatenate([state, song_mood])

            import torch
            with torch.no_grad():
                combined_tensor = torch.FloatTensor(combined)
                q_value = rl_agent.policy_net(combined_tensor).item()

            scored_songs.append({
                **song,
                'confidence': q_value,
                'mood_distance': mood_service.compute_mood_distance(
                    current_mood,
                    song['mood_vector']
                )
            })

        # Sort by confidence (Q-value) descending
        scored_songs.sort(key=lambda x: x['confidence'], reverse=True)

        # Return top N
        return scored_songs[:num_recommendations]

    def record_feedback(
        self,
        state: Dict,
        selected_song: Dict,
        feedback: Dict,
        next_state: Optional[Dict] = None
    ):
        """
        Record user feedback and train the RL agent

        Args:
            state: Previous state (mood, context)
            selected_song: The song that was played
            feedback: User feedback (played_fully, skipped, liked, etc.)
            next_state: New state after the song
        """

        # Encode state
        current_state_vec = rl_agent.encode_state(
            current_mood=state['current_mood'],
            recent_moods=state.get('recent_moods', []),
            time_of_day=state.get('time_of_day', 'afternoon'),
            device_type=state.get('device_type', 'web')
        )

        # Song action
        action_mood = selected_song['mood_vector']

        # Compute reward
        reward = rl_agent.compute_reward(
            was_played_fully=feedback.get('was_played_fully', False),
            was_skipped=feedback.get('was_skipped', False),
            was_liked=feedback.get('was_liked', False),
            was_replayed=feedback.get('was_replayed', False),
            play_duration_ratio=feedback.get('play_duration_ratio', 0.0)
        )

        # Next state
        if next_state:
            next_state_vec = rl_agent.encode_state(
                current_mood=next_state['current_mood'],
                recent_moods=next_state.get('recent_moods', []),
                time_of_day=next_state.get('time_of_day', 'afternoon'),
                device_type=next_state.get('device_type', 'web')
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
            done=done
        )

        # Train the agent
        loss = rl_agent.train_step(batch_size=32)

        return {
            'reward': reward,
            'loss': loss,
            'epsilon': rl_agent.epsilon
        }


recommendation_service = RecommendationService()
