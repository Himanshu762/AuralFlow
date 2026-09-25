"""The library keeps tracks, measurements and history for the DJ."""

from app.services import library_service


def _track(track_id, artist="Artist", genre="", title=None):
    return {
        "id": track_id,
        "title": title or f"Track {track_id}",
        "artist": artist,
        "album": "Album",
        "duration": 200,
        "cover": "",
        "genre": genre,
    }


def _measured(seconds=60):
    return {
        "seconds": seconds,
        "frames": seconds * 20,
        "loudness_db": -12.0,
        "crest_db": 8.0,
        "dynamic_range_db": 5.0,
        "centroid_hz": 2600.0,
        "flatness": 0.25,
        "flux": 0.35,
        "tempo_bpm": 128.0,
        "beat_strength": 0.8,
        "mode_major": 0.8,
        "vocal_ratio": 0.4,
        "vocal_modulation": 0.02,
        "hf_ratio": 0.15,
        "lf_ratio": 0.3,
    }


def test_upsert_is_idempotent_and_keeps_history(db):
    assert library_service.upsert_tracks(db, [_track("a"), _track("b")]) == 2
    library_service.record_play(db, "a")
    library_service.upsert_tracks(db, [_track("a", title="Renamed")])
    pool = {t["id"]: t for t in library_service.pool(db)}
    assert pool["a"]["title"] == "Renamed"
    assert pool["a"]["play_count"] == 1
    assert library_service.stats(db)["tracks"] == 2


def test_unknown_genre_is_reported_as_unknown(db):
    library_service.upsert_tracks(db, [_track("a")])
    resolved = library_service.resolve_mood(db, {"id": "a"})
    assert resolved["mood_source"] == "unknown"
    assert resolved["mood_known"] is False
    assert resolved["mood_label"] == ""


def test_genre_is_the_fallback(db):
    library_service.upsert_tracks(db, [_track("a", genre="ambient")])
    resolved = library_service.resolve_mood(db, {"id": "a"})
    assert resolved["mood_source"] == "genre"
    assert resolved["mood_known"] is True


def test_measurement_beats_genre_once_enough_audio_was_heard(db):
    library_service.upsert_tracks(db, [_track("a", genre="ambient")])
    genre_vec = library_service.resolve_mood(db, {"id": "a"})["mood_vector"]

    library_service.store_features(db, "a", _measured(seconds=60), seconds=60)
    resolved = library_service.resolve_mood(db, {"id": "a"})
    assert resolved["mood_source"] == "measured"
    assert resolved["mood_confidence"] == 1.0
    assert resolved["mood_vector"] != genre_vec
    # A loud, bright, fast, beat-heavy signal is not ambient.
    assert resolved["mood_vector"][0] > genre_vec[0]
    assert resolved["measured"]["tempo_bpm"] == 128


def test_short_measurement_is_kept_but_not_trusted(db):
    library_service.upsert_tracks(db, [_track("a", genre="ambient")])
    library_service.store_features(db, "a", _measured(seconds=5), seconds=5)
    resolved = library_service.resolve_mood(db, {"id": "a"})
    # Too little audio: the library falls back to the genre reading.
    assert resolved["mood_source"] == "genre"


def test_fuller_measurement_is_never_overwritten_by_a_shorter_one(db):
    library_service.upsert_tracks(db, [_track("a")])
    library_service.store_features(db, "a", _measured(seconds=90), seconds=90)
    full = library_service.resolve_mood(db, {"id": "a"})
    library_service.store_features(db, "a", {**_measured(seconds=10), "loudness_db": -40}, seconds=10)
    again = library_service.resolve_mood(db, {"id": "a"})
    assert again["mood_vector"] == full["mood_vector"]


def test_artist_prior_covers_unmeasured_tracks_by_the_same_artist(db):
    library_service.upsert_tracks(db, [_track("a", artist="Same"), _track("b", artist="Same"), _track("c", artist="Other")])
    library_service.store_features(db, "a", _measured(seconds=60), seconds=60)

    b = library_service.resolve_mood(db, {"id": "b", "artist": "Same"})
    assert b["mood_source"] == "artist"
    assert b["mood_vector"] == library_service.resolve_mood(db, {"id": "a"})["mood_vector"]

    c = library_service.resolve_mood(db, {"id": "c", "artist": "Other"})
    assert c["mood_source"] == "unknown"


def test_likes_and_outcomes_are_recorded(db):
    library_service.upsert_tracks(db, [_track("a")])
    library_service.set_liked(db, "a", True)
    library_service.record_outcome(db, "a", reward=-1.0, skipped=True)
    library_service.record_outcome(db, "a", reward=0.5, skipped=False)
    row = library_service.pool(db)[0]
    assert row["liked"] is True
    assert row["skip_count"] == 1
    assert row["mean_reward"] == -0.25


def test_pool_excludes_requested_ids(db):
    library_service.upsert_tracks(db, [_track("a"), _track("b")])
    ids = {t["id"] for t in library_service.pool(db, exclude_ids=["a"])}
    assert ids == {"b"}


def test_library_endpoints_round_trip(client):
    res = client.post("/api/v1/library/tracks", json={"tracks": [_track("x", genre="jazz")], "source": "search"})
    assert res.status_code == 200
    assert res.json()["stored"] == 1

    res = client.post("/api/v1/library/features", json={"track_id": "x", "seconds": 50, "features": _measured(50)})
    assert res.status_code == 200
    assert res.json()["mood_source"] == "measured"

    res = client.post("/api/v1/library/event", json={"track_id": "x", "event": "like"})
    assert res.json()["ok"] is True

    res = client.get("/api/v1/library/pool")
    body = res.json()
    assert body["stats"]["measured"] == 1
    assert body["tracks"][0]["liked"] is True

    res = client.post("/api/v1/recommendations/mood", json={"id": "x", "title": "T", "artist": "A", "genre": "jazz"})
    assert res.json()["mood_source"] == "measured"
    assert res.json()["measured"]["tempo_bpm"] == 128
