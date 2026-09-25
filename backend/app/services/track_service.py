"""
Track Service

Enriches track metadata from the shell with a mood vector. The library is
consulted first — a measured vector or an artist prior beats a genre lookup —
and the genre table is the fallback for tracks the library has never seen.
"""

from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.services import library_service
from app.services.mood_mapper import resolve_mood
from app.services.mood_service import mood_service


class TrackService:
    """Service for processing track metadata from the frontend"""

    def compute_track_mood(self, track: Dict, db: Optional[Session] = None) -> Dict:
        """
        Add `mood_vector`, `mood_label`, `mood_source`, `mood_confidence` and
        `mood_known` to a track dict.
        """
        if db is not None:
            resolved = library_service.resolve_mood(db, track)
            return {**track, **{k: v for k, v in resolved.items() if k != "measured"}, "measured": resolved["measured"]}

        genre = track.get("genre", "")
        mood_vector, mood_known = resolve_mood(genre)
        return {
            **track,
            "mood_vector": mood_vector,
            # Only label a mood we actually read. Without a genre the vector is
            # the neutral centre of the space, and calling that "Balanced"
            # would present a fallback as a finding.
            "mood_label": mood_service.get_mood_label(mood_vector) if mood_known else "",
            "mood_source": "genre" if mood_known else "unknown",
            "mood_confidence": 0.35 if mood_known else 0.0,
            "mood_known": mood_known,
            "measured": None,
        }

    def compute_batch_moods(self, tracks: List[Dict], db: Optional[Session] = None) -> List[Dict]:
        return [self.compute_track_mood(t, db) for t in tracks]


track_service = TrackService()
