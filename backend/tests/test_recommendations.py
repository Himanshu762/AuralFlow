"""Tests for the recommendation endpoints and scoring."""

import math

import pytest


def _candidate(track_id: str, genre: str = "electronic") -> dict:
    return {
        "id": track_id,
        "title": f"Track {track_id}",
        "artist": "Test Artist",
        "genre": genre,
        "album": "Test Album",
        "duration": 200,
        "cover_url": "",
    }


def test_health(client):
    assert client.get("/health").json() == {"status": "healthy"}


def test_mood_returns_five_dimensions(client):
    res = client.post(
        "/api/v1/recommendations/mood",
        json={"id": "t1", "title": "Track", "artist": "A", "genre": "electronic"},
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body["mood_vector"]) == 5
    assert all(0.0 <= v <= 1.0 for v in body["mood_vector"])
    assert body["mood_label"]


def test_score_returns_bounded_match(client):
    """`match` is what the UI shows as a percentage, so it must stay in 0..1.

    The raw Q-value may legitimately be negative on an untrained agent; that is
    why the UI uses `match` instead.
    """
    res = client.post(
        "/api/v1/recommendations/score",
        json={
            "candidates": [_candidate("a"), _candidate("b", "ambient")],
            "current_mood": [0.5, 0.5, 0.5, 0.5, 0.5],
            "recent_moods": [],
            "num_recommendations": 2,
        },
    )
    assert res.status_code == 200
    recs = res.json()["recommendations"]
    assert len(recs) == 2
    for r in recs:
        assert 0.0 <= r["match"] <= 1.0
        assert 0.0 <= r["mood_distance"] <= math.sqrt(5) + 1e-6


def test_match_is_higher_for_closer_mood(client):
    """A track whose mood sits on the listener's current mood should win."""
    from app.services.track_service import track_service

    electronic = track_service.compute_track_mood(_candidate("a"))["mood_vector"]

    res = client.post(
        "/api/v1/recommendations/score",
        json={
            "candidates": [_candidate("a"), _candidate("b", "ambient")],
            "current_mood": electronic,
            "recent_moods": [],
            "num_recommendations": 2,
        },
    )
    by_id = {r["id"]: r for r in res.json()["recommendations"]}
    assert by_id["a"]["match"] > by_id["b"]["match"]
    assert by_id["a"]["mood_distance"] == pytest.approx(0.0, abs=1e-6)


def test_score_handles_empty_candidates(client):
    res = client.post(
        "/api/v1/recommendations/score",
        json={"candidates": [], "current_mood": [0.5] * 5, "recent_moods": []},
    )
    assert res.status_code == 200
    assert res.json()["count"] == 0


def test_stats_shape(client):
    body = client.get("/api/v1/recommendations/stats").json()
    for key in ("exploration_rate", "memory_size", "training_steps", "last_reward"):
        assert key in body
    assert 0.0 <= body["exploration_rate"] <= 1.0


def test_unknown_genre_reports_no_match(client):
    """
    Monochrome's search results carry no genre, so most real candidates arrive
    without one. Their mood falls back to the neutral centre of the space,
    which sits zero distance from any listener mood — reporting that as a
    perfect match would show every track at 100%. There is simply no reading
    to give, and the response has to say so.
    """
    res = client.post(
        "/api/v1/recommendations/score",
        json={
            "candidates": [_candidate("a", genre=""), _candidate("b", genre="")],
            "current_mood": [0.5] * 5,
            "recent_moods": [],
            "num_recommendations": 2,
        },
    )
    assert res.status_code == 200
    recs = res.json()["recommendations"]
    assert len(recs) == 2
    for r in recs:
        assert r["match"] is None
        assert r["mood_distance"] is None
        assert r["mood_label"] == ""
        # Ranking still works — the agent scores every candidate.
        assert isinstance(r["confidence"], float)


def test_unrecognised_genre_is_treated_as_unknown(client):
    res = client.post(
        "/api/v1/recommendations/score",
        json={
            "candidates": [_candidate("a", genre="sea shanty vaporwave")],
            "current_mood": [0.5] * 5,
            "recent_moods": [],
        },
    )
    assert res.json()["recommendations"][0]["match"] is None


def test_known_genre_still_reports_a_match(client):
    res = client.post(
        "/api/v1/recommendations/score",
        json={
            "candidates": [_candidate("a", genre="ambient")],
            "current_mood": [0.5] * 5,
            "recent_moods": [],
        },
    )
    rec = res.json()["recommendations"][0]
    assert 0.0 <= rec["match"] <= 1.0
    assert rec["mood_label"]


def test_scoring_the_same_candidates_twice_gives_the_same_order(client):
    """Recommendations must not reshuffle between identical requests."""
    body = {
        "candidates": [_candidate(c, genre=g) for c, g in
                       (("a", "ambient"), ("b", "techno"), ("c", "jazz"), ("d", "rock"))],
        "current_mood": [0.5] * 5,
        "recent_moods": [],
        "num_recommendations": 4,
    }
    first = client.post("/api/v1/recommendations/score", json=body).json()
    second = client.post("/api/v1/recommendations/score", json=body).json()

    assert [r["id"] for r in first["recommendations"]] == [
        r["id"] for r in second["recommendations"]
    ]
    assert [r["confidence"] for r in first["recommendations"]] == [
        r["confidence"] for r in second["recommendations"]
    ]
