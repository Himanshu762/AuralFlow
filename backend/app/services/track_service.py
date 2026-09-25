"""
Track Service

Handles track metadata processing and mood vector computation.
The frontend sends track metadata (from Monochrome search results),
and this service computes mood vectors and manages the track cache.
"""

from typing import Dict, List, Optional
from app.services.mood_mapper import resolve_mood
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
        mood_vector, mood_known = resolve_mood(genre)

        return {
            **track,
            "mood_vector": mood_vector,
            # Only label a mood we actually read. Without a genre the vector is
            # the neutral centre of the space, and calling that "Balanced"
            # would present a fallback as a finding.
            "mood_label": mood_service.get_mood_label(mood_vector) if mood_known else "",
            "mood_known": mood_known,
        }

    def compute_batch_moods(self, tracks: List[Dict]) -> List[Dict]:
        """Compute mood vectors for a batch of tracks"""
        return [self.compute_track_mood(t) for t in tracks]


track_service = TrackService()
