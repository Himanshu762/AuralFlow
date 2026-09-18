"""
Track Service

Handles track metadata processing and mood vector computation.
The frontend sends track metadata (from Monochrome search results),
and this service computes mood vectors and manages the track cache.
"""

from typing import Dict, List, Optional
from app.services.mood_mapper import get_mood_vector
from app.services.mood_service import mood_service
import logging

logger = logging.getLogger(__name__)


class TrackService:
    """Service for processing track metadata from the frontend"""

    def compute_track_mood(self, track: Dict) -> Dict:
        """
        Take raw track metadata from the frontend and enrich it
        with a mood vector and mood label.

        Args:
            track: Dict with keys like {id, title, artist, genre, ...}

        Returns:
            Dict with added mood_vector and mood_label
        """
        genre = track.get("genre", "")
        mood_vector = get_mood_vector(genre)
        mood_label = mood_service.get_mood_label(mood_vector)

        return {
            **track,
            "mood_vector": mood_vector,
            "mood_label": mood_label,
        }

    def compute_batch_moods(self, tracks: List[Dict]) -> List[Dict]:
        """Compute mood vectors for a batch of tracks"""
        return [self.compute_track_mood(t) for t in tracks]


track_service = TrackService()
