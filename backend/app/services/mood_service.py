import numpy as np
from typing import Dict, List


class MoodService:
    """
    Mood-vector maths: labels, distances, trajectories and momentum.

    A mood vector is [energy, valence, danceability, acousticness,
    instrumentalness], each in [0, 1]. Where a vector comes from — measured
    audio, an artist prior or a genre lookup — is the library's business
    (see `library_service`); this module only reasons about vectors.
    """

    @staticmethod
    def get_mood_label(mood_vector: List[float]) -> str:
        energy, valence, danceability, acousticness, instrumentalness = mood_vector

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
        """Euclidean distance between two mood vectors."""
        return float(np.linalg.norm(np.array(mood1) - np.array(mood2)))

    @staticmethod
    def compute_mood_trajectory(mood_vectors: List[List[float]]) -> Dict:
        """Average, variance and energy/valence trend over a sequence."""
        if not mood_vectors:
            return {
                "average_mood": [0.5, 0.5, 0.5, 0.5, 0.5],
                "mood_variance": 0.0,
                "energy_trend": "stable",
                "valence_trend": "stable",
            }

        vectors = np.array(mood_vectors)
        avg_mood = np.mean(vectors, axis=0).tolist()
        variance = np.var(vectors)

        mid = len(vectors) // 2
        if mid > 0:
            def trend(col: int) -> str:
                first = np.mean(vectors[:mid, col])
                second = np.mean(vectors[mid:, col])
                if second > first + 0.1:
                    return "increasing"
                if second < first - 0.1:
                    return "decreasing"
                return "stable"

            energy_trend = trend(0)
            valence_trend = trend(1)
        else:
            energy_trend = valence_trend = "stable"

        return {
            "average_mood": avg_mood,
            "mood_variance": float(variance),
            "energy_trend": energy_trend,
            "valence_trend": valence_trend,
        }

    @staticmethod
    def predict_next_mood(
        recent_moods: List[List[float]],
        transition_weight: float = 0.3,
    ) -> List[float]:
        """
        Where the mood is heading if the listener keeps going as they are.

        Recency-weighted average of the recent moods plus a little momentum
        in the direction of the last transition, clipped to [0, 1].
        """
        if not recent_moods:
            return [0.5, 0.5, 0.5, 0.5, 0.5]

        weights = np.exp(np.linspace(0, 1, len(recent_moods)))
        weights = weights / np.sum(weights)

        vectors = np.array(recent_moods)
        weighted_avg = np.average(vectors, axis=0, weights=weights)

        if len(recent_moods) >= 2:
            momentum = (np.array(recent_moods[-1]) - np.array(recent_moods[-2])) * transition_weight
            predicted = np.clip(weighted_avg + momentum, 0.0, 1.0)
        else:
            predicted = weighted_avg

        return [float(v) for v in predicted]


mood_service = MoodService()
