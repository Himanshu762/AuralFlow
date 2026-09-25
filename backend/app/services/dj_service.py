"""
The DJ: closes the loop between mood, library and playback.

Every time a track starts, the shell asks the DJ what should follow. The DJ

1. works out where the session's *arc* says the mood should go next,
2. takes the candidate pool from the library (not from a search box),
3. ranks it with the RL policy blended against how well each track fits the
   target mood, with novelty, recency and diversity terms,
4. sometimes explores instead — and says so, so the UI can label the pick a
   discovery rather than pretend it was a confident choice,
5. returns one pick with an explanation, plus alternates.

The shell queues the pick as "play next" in the engine. The listener never
has to do anything; they can also reject the pick, which is a signal.

Arcs
----
An arc is a rule for the target mood, evaluated from the current mood:

- hold    keep the mood where it is
- drift   follow the momentum of the last few tracks
- lift    raise energy and valence, step by step
- settle  bring energy down, let acoustic and instrumental material in
- focus   move toward mid-energy instrumental material and stay there
- custom  head toward a listener-drawn vector over a horizon of tracks
"""

from __future__ import annotations

import math
import random
from typing import Dict, List, Optional, Sequence

import numpy as np

from app.services.mood_service import mood_service
from ml.agents.music_rl_agent import rl_agent

SQRT5 = math.sqrt(5)
DIMS = ["energy", "valence", "danceability", "acousticness", "instrumentalness"]

MODES = ("hold", "drift", "lift", "settle", "focus", "custom")

# Per-track steps for the directional arcs.
_LIFT_STEP = np.array([0.10, 0.06, 0.05, -0.03, -0.02])
_SETTLE_STEP = np.array([-0.10, 0.02, -0.06, 0.06, 0.04])
_FOCUS_TARGET = np.array([0.45, 0.50, 0.35, 0.55, 0.80])

# How much the policy's opinion counts. It starts small — an untrained
# network is noise — and grows with training steps until it carries just
# over half the decision. The rest is fit to the arc's target mood.
POLICY_WEIGHT_MIN = 0.08
POLICY_WEIGHT_MAX = 0.55
POLICY_WEIGHT_STEPS = 400

# A track played this recently is nearly off the table.
RECENT_PENALTY_HOURS = 2.0


def arc_target(
    mode: str,
    current_mood: Sequence[float],
    recent_moods: Sequence[Sequence[float]],
    custom_target: Optional[Sequence[float]] = None,
    position: int = 0,
    horizon: int = 6,
) -> List[float]:
    """The mood the next track should move toward."""
    current = np.clip(np.array(list(current_mood)[:5], dtype=float), 0, 1)
    mode = mode if mode in MODES else "drift"

    if mode == "hold":
        window = [np.array(m[:5], dtype=float) for m in list(recent_moods)[-3:]] + [current]
        target = np.mean(window, axis=0)
    elif mode == "drift":
        target = np.array(mood_service.predict_next_mood(list(recent_moods) + [list(current)], 0.3))
    elif mode == "lift":
        target = current + _LIFT_STEP
    elif mode == "settle":
        target = current + _SETTLE_STEP
    elif mode == "focus":
        target = current + (_FOCUS_TARGET - current) * 0.35
    else:  # custom
        goal = np.clip(np.array(list(custom_target or current)[:5], dtype=float), 0, 1)
        remaining = max(1, int(horizon) - int(position))
        target = current + (goal - current) / remaining

    return [round(float(v), 4) for v in np.clip(target, 0.0, 1.0)]


def describe_move(current: Sequence[float], target: Sequence[float]) -> str:
    """One clause about the biggest thing the arc is asking for."""
    deltas = [(t - c, i) for i, (c, t) in enumerate(zip(current, target))]
    delta, idx = max(deltas, key=lambda d: abs(d[0]))
    if abs(delta) < 0.03:
        return "holding the mood where it is"
    direction = "up" if delta > 0 else "down"
    return f"nudging {DIMS[idx]} {direction} ({current[idx]:.2f} → {target[idx]:.2f})"


def policy_weight() -> float:
    steps = rl_agent.training_steps
    return min(POLICY_WEIGHT_MAX, POLICY_WEIGHT_MIN + steps / POLICY_WEIGHT_STEPS)


def choose_next(
    candidates: List[Dict],
    current_mood: Sequence[float],
    recent_moods: Sequence[Sequence[float]],
    mode: str = "drift",
    custom_target: Optional[Sequence[float]] = None,
    position: int = 0,
    horizon: int = 6,
    current_track: Optional[Dict] = None,
    time_of_day: str = "afternoon",
    device_type: str = "desktop",
    exploration: Optional[float] = None,
    rng: Optional[random.Random] = None,
) -> Dict:
    """
    Pick what plays next from the candidate pool.

    Returns the pick, alternates, the arc target and a plain-language reason.
    An empty pool yields `pick: None` with the reason explaining why.
    """
    rng = rng or random.Random()
    target = arc_target(mode, current_mood, recent_moods, custom_target, position, horizon)
    current = [float(v) for v in list(current_mood)[:5]]

    current_id = str(current_track.get("id")) if current_track and current_track.get("id") else None
    current_artist = (current_track or {}).get("artist")

    pool = [c for c in candidates if str(c.get("id")) != current_id]
    if not pool:
        return {
            "pick": None,
            "alternates": [],
            "target": target,
            "mode": mode,
            "reason": "The library has nothing else to choose from yet — play or search for more.",
            "pool_size": 0,
            "exploring": False,
            "policy_weight": policy_weight(),
        }

    state = rl_agent.encode_state(
        current_mood=current,
        recent_moods=[list(m) for m in recent_moods],
        time_of_day=time_of_day,
        device_type=device_type,
        target_mood=target,
    )
    q_values = np.array(rl_agent.score_batch(state, [c["mood_vector"] for c in pool]), dtype=float)
    if q_values.size > 1 and q_values.std() > 1e-6:
        q_norm = (q_values - q_values.mean()) / q_values.std()
    else:
        q_norm = np.zeros_like(q_values)
    q_sig = 1.0 / (1.0 + np.exp(-q_norm))

    w_q = policy_weight()
    w_fit = 1.0 - w_q

    scored = []
    for c, q, qs in zip(pool, q_values, q_sig):
        known = bool(c.get("mood_known", True))
        distance = float(np.linalg.norm(np.array(c["mood_vector"]) - np.array(target)))
        fit = 1.0 - distance / SQRT5
        # A track whose mood we cannot read might fit perfectly or terribly;
        # score it as a coin toss, discounted, and let exploration find it.
        fit_term = fit if known else 0.3
        confidence = float(c.get("mood_confidence") or (1.0 if known else 0.0))
        fit_term = fit_term * (0.7 + 0.3 * confidence)

        bonus = 0.0
        if (c.get("play_count") or 0) == 0:
            bonus += 0.06
        if c.get("liked"):
            bonus += 0.05
        if c.get("mean_reward") is not None:
            bonus += 0.10 * float(c["mean_reward"])
        if c.get("skip_count") and (c.get("play_count") or 0) > 0:
            bonus -= 0.08 * (c["skip_count"] / max(1, c["play_count"]))
        if current_artist and c.get("artist") == current_artist and len(pool) > 5:
            bonus -= 0.08
        recent_hours = _hours_since(c.get("last_played_at"))
        if recent_hours is not None and recent_hours < RECENT_PENALTY_HOURS:
            bonus -= 0.25 * (1.0 - recent_hours / RECENT_PENALTY_HOURS)

        score = w_q * float(qs) + w_fit * fit_term + bonus
        scored.append(
            {
                **c,
                "q_value": round(float(q), 4),
                "fit": round(fit, 4) if known else None,
                "score": round(float(score), 4),
                "distance": round(distance, 4) if known else None,
            }
        )

    scored.sort(key=lambda s: s["score"], reverse=True)

    eps = rl_agent.epsilon if exploration is None else exploration
    exploring = len(scored) > 2 and rng.random() < eps
    if exploring:
        # Prefer to spend exploration on tracks we have never measured — that
        # is how the library learns what they sound like.
        unknown = [s for s in scored if not s.get("mood_known", True) or (s.get("mood_source") != "measured")]
        source = unknown if unknown and rng.random() < 0.6 else scored[1:8]
        pick = rng.choice(source)
    else:
        pick = scored[0]

    alternates = [s for s in scored if s["id"] != pick["id"]][:4]

    return {
        "pick": pick,
        "alternates": alternates,
        "target": target,
        "mode": mode,
        "reason": _reason(pick, current, target, exploring, w_q),
        "pool_size": len(pool),
        "exploring": exploring,
        "policy_weight": round(w_q, 3),
    }


def _reason(pick: Dict, current: Sequence[float], target: Sequence[float], exploring: bool, w_q: float) -> str:
    move = describe_move(current, target)
    source = pick.get("mood_source")
    if source == "measured":
        secs = pick.get("measured", {}) or {}
        basis = "its mood was measured from the audio"
        if isinstance(pick.get("mood_confidence"), (int, float)) and pick["mood_confidence"] < 0.7:
            basis += " (partly)"
    elif source == "artist":
        basis = f"other tracks by {pick.get('artist') or 'this artist'} have been measured"
    elif source == "genre":
        basis = "only its genre tag is known"
    else:
        basis = "its mood has not been read yet"

    if exploring:
        return f"Discovery pick — {basis}. The arc is {move}; this one is here to learn from."

    fit = pick.get("fit")
    fit_text = f"{round(fit * 100)}% fit to the target" if isinstance(fit, (int, float)) else "no mood fit to report"
    return f"{fit_text} while {move}; {basis}. Policy weight {round(w_q * 100)}%."


def _hours_since(iso: Optional[str]) -> Optional[float]:
    if not iso:
        return None
    from datetime import datetime, timezone

    try:
        then = datetime.fromisoformat(iso)
        if then.tzinfo is None:
            then = then.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - then).total_seconds() / 3600.0)
    except ValueError:
        return None
