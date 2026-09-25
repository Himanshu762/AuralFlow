"""The DJ picks from the library along an arc, and explains itself."""

import random

import pytest

from app.services import dj_service, library_service
from tests.test_library import _measured, _track


def _cand(track_id, mood, **extra):
    return {
        "id": track_id,
        "title": track_id,
        "artist": extra.pop("artist", f"artist-{track_id}"),
        "mood_vector": mood,
        "mood_known": True,
        "mood_source": "measured",
        "mood_confidence": 1.0,
        "play_count": 0,
        "skip_count": 0,
        "liked": False,
        "last_played_at": None,
        "mean_reward": None,
        **extra,
    }


def test_arc_modes_move_the_target_the_right_way():
    current = [0.5] * 5
    assert dj_service.arc_target("hold", current, []) == pytest.approx(current)
    assert dj_service.arc_target("lift", current, [])[0] > 0.5
    assert dj_service.arc_target("settle", current, [])[0] < 0.5
    assert dj_service.arc_target("settle", current, [])[3] > 0.5
    focus = dj_service.arc_target("focus", current, [])
    assert focus[4] > 0.5
    custom = dj_service.arc_target("custom", current, [], custom_target=[1, 1, 1, 1, 1], position=0, horizon=4)
    assert all(0.5 < v < 1.0 for v in custom)
    # The last step of a custom arc lands on the goal.
    last = dj_service.arc_target("custom", current, [], custom_target=[1, 1, 1, 1, 1], position=3, horizon=4)
    assert last == pytest.approx([1.0] * 5)


def test_drift_follows_momentum():
    recent = [[0.2] * 5, [0.4] * 5]
    target = dj_service.arc_target("drift", [0.6] * 5, recent)
    assert target[0] > 0.5


def test_pick_fits_the_target_when_the_policy_is_untrained(agent):
    calm = _cand("calm", [0.15, 0.4, 0.2, 0.9, 0.8])
    loud = _cand("loud", [0.9, 0.7, 0.9, 0.1, 0.1])
    result = dj_service.choose_next(
        [calm, loud], current_mood=[0.2, 0.4, 0.2, 0.85, 0.8], recent_moods=[],
        mode="hold", exploration=0.0, rng=random.Random(1),
    )
    assert result["pick"]["id"] == "calm"
    assert result["exploring"] is False
    assert "fit" in result["reason"]
    assert result["alternates"][0]["id"] == "loud"


def test_lift_prefers_the_more_energetic_track(agent):
    calm = _cand("calm", [0.25, 0.5, 0.3, 0.6, 0.5])
    mid = _cand("mid", [0.5, 0.55, 0.5, 0.4, 0.4])
    result = dj_service.choose_next(
        [calm, mid], current_mood=[0.4, 0.5, 0.4, 0.5, 0.5], recent_moods=[],
        mode="lift", exploration=0.0, rng=random.Random(1),
    )
    assert result["pick"]["id"] == "mid"


def test_current_track_is_never_picked(agent):
    a = _cand("a", [0.5] * 5)
    result = dj_service.choose_next([a], current_mood=[0.5] * 5, recent_moods=[], current_track={"id": "a"})
    assert result["pick"] is None
    assert result["pool_size"] == 0


def test_recently_played_tracks_are_pushed_down(agent):
    from datetime import datetime, timezone

    fresh = _cand("fresh", [0.5] * 5)
    stale = _cand("stale", [0.5] * 5, last_played_at=datetime.now(timezone.utc).isoformat(), play_count=1)
    result = dj_service.choose_next([stale, fresh], current_mood=[0.5] * 5, recent_moods=[], exploration=0.0)
    assert result["pick"]["id"] == "fresh"


def test_exploration_is_flagged_and_explained(agent):
    cands = [_cand(str(i), [i / 10] * 5) for i in range(10)]
    cands.append({**_cand("mystery", [0.5] * 5), "mood_known": False, "mood_source": "unknown", "mood_confidence": 0.0})
    result = dj_service.choose_next(cands, current_mood=[0.5] * 5, recent_moods=[], exploration=1.0, rng=random.Random(3))
    assert result["exploring"] is True
    assert result["reason"].startswith("Discovery pick")


def test_policy_weight_grows_with_training(agent):
    agent.training_steps = 0
    low = dj_service.policy_weight()
    agent.training_steps = 10_000
    assert dj_service.policy_weight() > low
    assert dj_service.policy_weight() <= dj_service.POLICY_WEIGHT_MAX


def test_next_endpoint_uses_the_library(client, agent):
    client.post("/api/v1/library/tracks", json={"tracks": [_track("a", genre="ambient"), _track("b", genre="techno")]})
    client.post("/api/v1/library/features", json={"track_id": "a", "seconds": 60, "features": {**_measured(60), "loudness_db": -30, "tempo_bpm": 70, "beat_strength": 0.1, "flux": 0.05}})

    res = client.post("/api/v1/dj/next", json={
        "current_mood": [0.2, 0.4, 0.2, 0.8, 0.8],
        "recent_moods": [],
        "mode": "hold",
        "current_track": {"id": "b", "artist": "Artist"},
    })
    assert res.status_code == 200
    body = res.json()
    assert body["pick"]["id"] == "a"
    assert body["pool_size"] == 1
    assert body["library"]["measured"] == 1
    assert len(body["target"]) == 5


def test_reject_is_a_negative_signal(client, agent):
    client.post("/api/v1/library/tracks", json={"tracks": [_track("a")]})
    res = client.post("/api/v1/dj/reject", json={
        "track_id": "a",
        "song_mood_vector": [0.5] * 5,
        "state": {"current_mood": [0.5] * 5, "recent_moods": []},
    })
    assert res.json()["reward"] == -0.5
    assert len(agent.memory) == 1
    assert client.get("/api/v1/library/pool").json()["tracks"][0]["skip_count"] == 1


def test_feedback_bootstraps_from_the_next_transition(client, agent):
    res = client.post("/api/v1/recommendations/feedback", json={
        "track_id": "a",
        "song_mood_vector": [0.5] * 5,
        "state": {"current_mood": [0.5] * 5, "recent_moods": [], "target_mood": [0.6] * 5},
        "next_state": {"current_mood": [0.6] * 5, "recent_moods": [[0.5] * 5]},
        "next_song_mood_vector": [0.7] * 5,
        "was_played_fully": True,
        "play_duration_ms": 200000,
        "total_duration_ms": 200000,
    })
    assert res.status_code == 200
    assert res.json()["reward"] == 0.5
    exp = agent.memory[-1]
    assert exp["done"] is False
    assert exp["next_action"] == pytest.approx([0.7] * 5)
    assert len(exp["state"]) == 17


def test_modes_endpoint(client):
    body = client.get("/api/v1/dj/modes").json()
    assert {m["id"] for m in body["modes"]} == set(dj_service.MODES)
