"""
The listener's library — the DJ's candidate pool.

Everything the shell sees goes through here: search results, plays, likes,
imported playlists, artist and album lookups. The library keeps the metadata,
records how each track was received, and stores the mood the engine measured
from the audio as it played.

Resolving a track's mood follows a fixed order of trust:

1. **measured** — the engine analysed enough of the audio (see
   `feature_service`) to read a vector off the signal itself.
2. **artist** — nothing measured for this track, but other tracks by the same
   artist have been, so their average is a reasonable prior.
3. **genre** — a genre tag mapped through the lookup table.
4. **unknown** — nothing to go on. The vector is the neutral centre and the
   caller is told so, rather than being handed a fake reading.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.song import Song
from app.services import feature_service
from app.services.mood_mapper import resolve_mood as genre_mood
from app.services.mood_service import mood_service

NEUTRAL = [0.5, 0.5, 0.5, 0.5, 0.5]

# A prior built from an artist's other tracks is only ever partly trusted.
ARTIST_PRIOR_CONFIDENCE = 0.5


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------- #
# Upserts                                                                #
# ---------------------------------------------------------------------- #


def upsert_tracks(db: Session, tracks: Iterable[Dict], source: str = "search") -> int:
    """
    Insert new tracks and refresh metadata on known ones.

    Never touches measured moods or listening history; those only move
    through their own paths.
    """
    count = 0
    for t in tracks:
        track_id = str(t.get("id") or "").strip()
        if not track_id:
            continue
        song = db.query(Song).filter(Song.track_id == track_id).first()
        if song is None:
            song = Song(track_id=track_id, name="", artist="", source=source)
            db.add(song)
        _apply_metadata(song, t)
        # A genre we did not have before can improve an unmeasured track.
        if song.mood_source in (None, "unknown", "genre"):
            _refresh_fallback_mood(song)
        count += 1
    db.commit()
    return count


def _apply_metadata(song: Song, t: Dict) -> None:
    song.name = str(t.get("title") or t.get("name") or song.name or "")
    song.artist = str(t.get("artist") or song.artist or "")
    if t.get("artist_id") or t.get("artistId"):
        song.artist_id = str(t.get("artist_id") or t.get("artistId"))
    if t.get("album"):
        song.album = str(t["album"])
    if t.get("album_id") or t.get("albumId"):
        song.album_id = str(t.get("album_id") or t.get("albumId"))
    if t.get("genre"):
        song.genre = str(t["genre"])
    duration = t.get("duration")
    if isinstance(duration, (int, float)) and duration > 0:
        song.duration_ms = int(duration * 1000)
    if t.get("cover") or t.get("cover_url"):
        song.cover = str(t.get("cover") or t.get("cover_url"))
    if t.get("coverLarge") or t.get("cover_large"):
        song.cover_large = str(t.get("coverLarge") or t.get("cover_large"))
    if t.get("audioQuality") or t.get("audio_quality"):
        song.audio_quality = str(t.get("audioQuality") or t.get("audio_quality"))
    modes = t.get("audioModes") or t.get("audio_modes")
    if isinstance(modes, list):
        song.audio_modes = [str(m) for m in modes]


def _refresh_fallback_mood(song: Song) -> None:
    vector, known = genre_mood(song.genre or "")
    if known:
        _set_mood(song, vector, "genre", 0.35)
    elif song.mood_source is None:
        song.mood_source = "unknown"
        song.mood_confidence = 0.0


def _set_mood(song: Song, vector: List[float], source: str, confidence: float) -> None:
    song.mood_vector = [round(float(v), 4) for v in vector]
    song.energy, song.valence, song.danceability, song.acousticness, song.instrumentalness = song.mood_vector
    song.mood_source = source
    song.mood_confidence = round(float(confidence), 4)


# ---------------------------------------------------------------------- #
# Measured features                                                      #
# ---------------------------------------------------------------------- #


def store_features(db: Session, track_id: str, features: Dict, seconds: float) -> Optional[Song]:
    """
    Record what the engine measured while the track played.

    Measurements arrive progressively; each one replaces the last because the
    bridge reports running aggregates over everything heard so far.
    """
    song = db.query(Song).filter(Song.track_id == str(track_id)).first()
    if song is None:
        return None

    frames = int(features.get("frames") or 0)
    confidence = feature_service.confidence_for(float(seconds or 0), frames)

    # Never let a shorter, later measurement (a replay that was skipped early)
    # overwrite a fuller one.
    if song.mood_source == "measured" and (song.mood_confidence or 0) > confidence + 0.05:
        return song

    vector = feature_service.mood_from_features(features)
    song.features = features
    song.analysis_seconds = float(seconds or 0)
    song.analysed_at = _now()

    if feature_service.usable(confidence):
        _set_mood(song, vector, "measured", confidence)
    else:
        # Too little audio to trust on its own: lean on whatever prior we had.
        prior, _, _ = _prior_for(db, song)
        _set_mood(song, feature_service.blend(vector, confidence, prior), "measured", confidence)

    db.commit()
    return song


def _prior_for(db: Session, song: Song) -> Tuple[List[float], str, float]:
    """Best non-measured estimate: artist average, then genre, then neutral."""
    artist = artist_prior(db, song.artist, exclude_track_id=song.track_id)
    if artist is not None:
        return artist
    vector, known = genre_mood(song.genre or "")
    if known:
        return vector, "genre", 0.35
    return list(NEUTRAL), "unknown", 0.0


def artist_prior(db: Session, artist: str, exclude_track_id: Optional[str] = None) -> Optional[Tuple[List[float], str, float]]:
    """Confidence-weighted mean of an artist's measured tracks."""
    if not artist:
        return None
    query = db.query(Song).filter(
        Song.artist == artist,
        Song.mood_source == "measured",
        Song.mood_confidence >= feature_service.MIN_USABLE_CONFIDENCE,
    )
    if exclude_track_id:
        query = query.filter(Song.track_id != exclude_track_id)
    rows = query.all()
    if not rows:
        return None
    total = sum(r.mood_confidence or 0 for r in rows)
    if total <= 0:
        return None
    mean = [
        sum((r.mood_vector or NEUTRAL)[i] * (r.mood_confidence or 0) for r in rows) / total
        for i in range(5)
    ]
    return [round(v, 4) for v in mean], "artist", ARTIST_PRIOR_CONFIDENCE


def resolve_mood(db: Session, track: Dict) -> Dict:
    """
    The best mood we can give for a track the shell describes.

    Returns the vector, where it came from, how much to trust it, and a
    label. `known` is False only when there is truly nothing to go on.
    """
    track_id = str(track.get("id") or "")
    song = db.query(Song).filter(Song.track_id == track_id).first() if track_id else None

    if song is not None and song.mood_source == "measured" and feature_service.usable(song.mood_confidence or 0):
        vector = song.mood_vector or NEUTRAL
        return _resolved(vector, "measured", song.mood_confidence or 0, song)

    artist = (song.artist if song else None) or track.get("artist") or ""
    prior = artist_prior(db, artist, exclude_track_id=track_id or None)
    if prior is not None:
        vector, source, confidence = prior
        return _resolved(vector, source, confidence, song)

    genre = (song.genre if song else None) or track.get("genre") or ""
    vector, known = genre_mood(genre)
    if known:
        return _resolved(vector, "genre", 0.35, song)

    return {
        "mood_vector": list(NEUTRAL),
        "mood_source": "unknown",
        "mood_confidence": 0.0,
        "mood_label": "",
        "mood_known": False,
        "measured": None,
    }


def _resolved(vector: List[float], source: str, confidence: float, song: Optional[Song]) -> Dict:
    return {
        "mood_vector": [round(float(v), 4) for v in vector],
        "mood_source": source,
        "mood_confidence": round(float(confidence), 4),
        "mood_label": mood_service.get_mood_label(vector),
        "mood_known": True,
        "measured": feature_service.summarise(song.features) if song is not None and song.features else None,
    }


# ---------------------------------------------------------------------- #
# Listening history                                                      #
# ---------------------------------------------------------------------- #


def record_play(db: Session, track_id: str) -> None:
    song = db.query(Song).filter(Song.track_id == str(track_id)).first()
    if song is None:
        return
    song.play_count = (song.play_count or 0) + 1
    song.last_played_at = _now()
    db.commit()


def record_outcome(db: Session, track_id: str, reward: float, skipped: bool) -> None:
    song = db.query(Song).filter(Song.track_id == str(track_id)).first()
    if song is None:
        return
    song.reward_total = (song.reward_total or 0.0) + float(reward)
    song.reward_count = (song.reward_count or 0) + 1
    if skipped:
        song.skip_count = (song.skip_count or 0) + 1
    db.commit()


def set_liked(db: Session, track_id: str, liked: bool) -> None:
    song = db.query(Song).filter(Song.track_id == str(track_id)).first()
    if song is None:
        return
    song.liked = bool(liked)
    db.commit()


# ---------------------------------------------------------------------- #
# The pool                                                               #
# ---------------------------------------------------------------------- #


def pool(db: Session, limit: int = 400, exclude_ids: Optional[Iterable[str]] = None) -> List[Dict]:
    """
    Candidate tracks the DJ may choose from, with everything it needs to
    rank them. Tracks with no usable mood are included but flagged, so the
    DJ can decide how adventurous to be with them.
    """
    excluded = {str(x) for x in (exclude_ids or [])}
    rows = (
        db.query(Song)
        .filter(Song.name != "")
        .order_by(Song.last_played_at.desc().nullslast(), Song.first_seen_at.desc())
        .limit(limit * 2)
        .all()
    )
    out: List[Dict] = []
    for song in rows:
        if song.track_id in excluded:
            continue
        out.append(_candidate(db, song))
        if len(out) >= limit:
            break
    return out


def _candidate(db: Session, song: Song) -> Dict:
    resolved = resolve_mood(db, {"id": song.track_id, "artist": song.artist, "genre": song.genre})
    return {
        "id": song.track_id,
        "title": song.name,
        "artist": song.artist,
        "artistId": song.artist_id,
        "album": song.album or "",
        "albumId": song.album_id,
        "duration": (song.duration_ms or 0) / 1000.0,
        "cover": song.cover or "",
        "coverLarge": song.cover_large or song.cover or "",
        "audioQuality": song.audio_quality or "",
        "audioModes": song.audio_modes or [],
        "genre": song.genre or "",
        "mood_vector": resolved["mood_vector"],
        "mood_source": resolved["mood_source"],
        "mood_confidence": resolved["mood_confidence"],
        "mood_label": resolved["mood_label"],
        "mood_known": resolved["mood_known"],
        "play_count": song.play_count or 0,
        "skip_count": song.skip_count or 0,
        "liked": bool(song.liked),
        "last_played_at": song.last_played_at.isoformat() if song.last_played_at else None,
        "mean_reward": (
            (song.reward_total or 0.0) / song.reward_count if song.reward_count else None
        ),
    }


def stats(db: Session) -> Dict:
    total = db.query(func.count(Song.id)).scalar() or 0
    by_source = dict(
        db.query(Song.mood_source, func.count(Song.id)).group_by(Song.mood_source).all()
    )
    return {
        "tracks": int(total),
        "measured": int(by_source.get("measured", 0)),
        "artist_prior": int(by_source.get("artist", 0)),
        "genre": int(by_source.get("genre", 0)),
        "unknown": int(by_source.get("unknown", 0) + by_source.get(None, 0)),
        "liked": int(db.query(func.count(Song.id)).filter(Song.liked.is_(True)).scalar() or 0),
        "played": int(db.query(func.count(Song.id)).filter(Song.play_count > 0).scalar() or 0),
        "artists": int(db.query(func.count(func.distinct(Song.artist))).scalar() or 0),
    }
