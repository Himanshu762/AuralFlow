import numpy as np
from typing import Dict, List, Tuple


class MoodService:
    """
    Service for computing and analyzing mood vectors from audio features

    Mood vectors represent the emotional state of a song as a compact
    mathematical representation combining Spotify's audio features.
    """

    @staticmethod
    def compute_mood_vector(audio_features: Dict) -> List[float]:
        """
        Compute a mood vector from Spotify audio features

        The mood vector is a normalized combination of key features:
        - energy: intensity
        - valence: happiness/positivity
        - danceability: rhythmic quality
        - acousticness: organic vs electronic
        - instrumentalness: vocal vs instrumental

        Returns a 5-dimensional vector
        """
        if not audio_features:
            return [0.5, 0.5, 0.5, 0.5, 0.5]

        mood_vector = [
            audio_features.get("energy", 0.5),
            audio_features.get("valence", 0.5),
            audio_features.get("danceability", 0.5),
            audio_features.get("acousticness", 0.5),
            audio_features.get("instrumentalness", 0.5)
        ]

        return mood_vector

    @staticmethod
    def get_mood_label(mood_vector: List[float]) -> str:
        """
        Get a human-readable mood label from a mood vector

        Examples:
        - High energy, high valence → "Energetic & Happy"
        - Low energy, low valence → "Calm & Melancholic"
        - High energy, low valence → "Intense & Dark"
        """
        energy, valence, danceability, acousticness, instrumentalness = mood_vector

        # Determine primary mood characteristics
        if energy > 0.7 and valence > 0.7:
            return "Energetic & Uplifting"
        elif energy > 0.7 and valence < 0.3:
            return "Intense & Dark"
        elif energy < 0.3 and valence > 0.7:
            return "Calm & Peaceful"
        elif energy < 0.3 and valence < 0.3:
            return "Melancholic & Introspective"
        elif danceability > 0.7:
            return "Danceable & Rhythmic"
        elif acousticness > 0.7:
            return "Acoustic & Organic"
        elif instrumentalness > 0.7:
            return "Instrumental & Ambient"
        else:
            return "Balanced"

    @staticmethod
    def compute_mood_distance(mood1: List[float], mood2: List[float]) -> float:
        """
        Compute the Euclidean distance between two mood vectors

        Smaller distance = more similar moods
        Used for measuring mood flow consistency
        """
        vec1 = np.array(mood1)
        vec2 = np.array(mood2)
        return np.linalg.norm(vec1 - vec2)

    @staticmethod
    def compute_mood_trajectory(mood_vectors: List[List[float]]) -> Dict:
        """
        Compute statistics about a sequence of mood vectors (a listening session)

        Returns:
        - average_mood: mean mood vector
        - mood_variance: how much mood varied
        - trend: whether mood is increasing or decreasing in energy/valence
        """
        if not mood_vectors or len(mood_vectors) == 0:
            return {
                "average_mood": [0.5, 0.5, 0.5, 0.5, 0.5],
                "mood_variance": 0.0,
                "energy_trend": "stable",
                "valence_trend": "stable"
            }

        vectors = np.array(mood_vectors)

        # Average mood
        avg_mood = np.mean(vectors, axis=0).tolist()

        # Variance
        variance = np.var(vectors)

        # Trends (comparing first half to second half)
        mid = len(vectors) // 2
        if mid > 0:
            first_half_energy = np.mean(vectors[:mid, 0])
            second_half_energy = np.mean(vectors[mid:, 0])
            energy_trend = "increasing" if second_half_energy > first_half_energy + 0.1 else \
                          "decreasing" if second_half_energy < first_half_energy - 0.1 else "stable"

            first_half_valence = np.mean(vectors[:mid, 1])
            second_half_valence = np.mean(vectors[mid:, 1])
            valence_trend = "increasing" if second_half_valence > first_half_valence + 0.1 else \
                           "decreasing" if second_half_valence < first_half_valence - 0.1 else "stable"
        else:
            energy_trend = "stable"
            valence_trend = "stable"

        return {
            "average_mood": avg_mood,
            "mood_variance": float(variance),
            "energy_trend": energy_trend,
            "valence_trend": valence_trend
        }

    @staticmethod
    def predict_next_mood(
        recent_moods: List[List[float]],
        transition_weight: float = 0.3
    ) -> List[float]:
        """
        Predict the next mood based on recent mood trajectory

        Uses weighted average with emphasis on recent moods
        transition_weight: how much to shift from the current mood (0.0 to 1.0)

        This is a simple heuristic - the RL model will do more sophisticated prediction
        """
        if not recent_moods or len(recent_moods) == 0:
            return [0.5, 0.5, 0.5, 0.5, 0.5]

        # Weight recent moods more heavily
        weights = np.exp(np.linspace(0, 1, len(recent_moods)))
        weights = weights / np.sum(weights)

        vectors = np.array(recent_moods)
        weighted_avg = np.average(vectors, axis=0, weights=weights)

        # Add slight momentum in the direction of trend
        if len(recent_moods) >= 2:
            last_mood = np.array(recent_moods[-1])
            prev_mood = np.array(recent_moods[-2])
            momentum = (last_mood - prev_mood) * transition_weight
            predicted = weighted_avg + momentum
            # Clip to valid range [0, 1]
            predicted = np.clip(predicted, 0.0, 1.0)
        else:
            predicted = weighted_avg

        return predicted.tolist()


mood_service = MoodService()
