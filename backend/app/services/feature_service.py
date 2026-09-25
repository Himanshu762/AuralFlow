"""
Measured audio features → the 5-D mood vector.

The engine bridge listens to the audio graph while a track plays and reports
what it measured: loudness and dynamics, spectral shape, an onset-based tempo
estimate, a chroma-based major/minor reading and how much of the energy sits
in the vocal band. This module turns those measurements into the mood vector
the DJ steers by:

    [energy, valence, danceability, acousticness, instrumentalness]

Every mapping here is a documented heuristic over signal measurements, not a
trained model. Valence in particular is a proxy: major mode, brightness and
tempo correlate with "happier" music but do not define it. The vector carries
a confidence that grows with how much of the track has actually been heard,
and the UI labels it as measured so nobody mistakes it for ground truth.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple

MOOD_DIMS = 5

# Seconds of audio after which a measurement is treated as fully confident.
FULL_CONFIDENCE_SECONDS = 45.0
# Below this the measurement is kept but not trusted to drive the DJ.
MIN_USABLE_CONFIDENCE = 0.3


def _norm(value: Optional[float], low: float, high: float) -> float:
    """Linear map of value from [low, high] onto [0, 1], clamped."""
    if value is None or not math.isfinite(value):
        return 0.5
    if high == low:
        return 0.5
    return max(0.0, min(1.0, (float(value) - low) / (high - low)))


def _gauss(value: Optional[float], centre: float, width: float) -> float:
    """Bell curve peaking at `centre`, 0..1."""
    if value is None or not math.isfinite(value):
        return 0.0
    return math.exp(-0.5 * ((float(value) - centre) / width) ** 2)


def confidence_for(seconds: float, frames: int = 0) -> float:
    """How much to trust a measurement: grows with audio actually analysed."""
    if seconds <= 0 or frames <= 0:
        return 0.0
    return max(0.0, min(1.0, seconds / FULL_CONFIDENCE_SECONDS))


def mood_from_features(features: Dict) -> List[float]:
    """
    Map measured features to [energy, valence, danceability, acousticness,
    instrumentalness]. See the module docstring for the reasoning.
    """
    f = features or {}

    loudness = f.get("loudness_db")
    flux = f.get("flux")
    centroid = f.get("centroid_hz")
    tempo = f.get("tempo_bpm")
    beat = f.get("beat_strength")
    mode_major = f.get("mode_major")
    flatness = f.get("flatness")
    crest = f.get("crest_db")
    dynamic_range = f.get("dynamic_range_db")
    hf_ratio = f.get("hf_ratio")
    lf_ratio = f.get("lf_ratio")
    vocal_ratio = f.get("vocal_ratio")
    vocal_mod = f.get("vocal_modulation")

    # Energy: how loud and busy the signal is. Loudness carries most of it;
    # spectral flux (how fast the spectrum changes) and brightness add the
    # rest, with tempo as a small nudge.
    energy = (
        0.45 * _norm(loudness, -36.0, -8.0)
        + 0.25 * _norm(flux, 0.0, 0.45)
        + 0.15 * _norm(centroid, 600.0, 4000.0)
        + 0.15 * _norm(tempo, 60.0, 180.0)
    )

    # Valence (proxy): major mode reads brighter than minor, faster and
    # brighter material tends to be rated more positive. Dynamic range
    # slightly lowers it — very compressed loud masters skew "intense" rather
    # than "happy".
    valence = (
        0.40 * (mode_major if isinstance(mode_major, (int, float)) else 0.5)
        + 0.30 * _norm(tempo, 70.0, 160.0)
        + 0.30 * _norm(centroid, 800.0, 3500.0)
    )

    # Danceability: a strong, regular beat in the range people dance to,
    # with some low end to carry it.
    danceability = (
        0.50 * (beat if isinstance(beat, (int, float)) else 0.4)
        + 0.30 * (_gauss(tempo, 118.0, 26.0) if tempo else 0.4)
        + 0.20 * _norm(lf_ratio, 0.05, 0.35)
    )

    # Acousticness: acoustic recordings keep their dynamics and have a less
    # flat, less sizzly spectrum than electronic production.
    acousticness = (
        0.35 * (1.0 - _norm(flatness, 0.02, 0.35))
        + 0.30 * _norm(crest, 6.0, 20.0)
        + 0.15 * _norm(dynamic_range, 4.0, 18.0)
        + 0.20 * (1.0 - _norm(hf_ratio, 0.02, 0.22))
    )

    # Instrumentalness: vocals put modulated energy in the 300–3400 Hz band.
    # Lots of steady energy there could be anything; lots of *varying* energy
    # there is usually a voice.
    vocal_presence = 0.55 * _norm(vocal_ratio, 0.18, 0.55) + 0.45 * _norm(vocal_mod, 0.002, 0.03)
    instrumentalness = 1.0 - vocal_presence

    return [round(max(0.0, min(1.0, v)), 4) for v in (energy, valence, danceability, acousticness, instrumentalness)]


def summarise(features: Dict) -> Dict:
    """The handful of measured facts worth showing a listener."""
    f = features or {}
    tempo = f.get("tempo_bpm")
    mode = f.get("mode_major")
    return {
        "tempo_bpm": round(float(tempo)) if isinstance(tempo, (int, float)) and tempo else None,
        "mode": None if not isinstance(mode, (int, float)) else ("major" if mode >= 0.5 else "minor"),
        "key": f.get("key"),
        "loudness_db": _round(f.get("loudness_db"), 1),
        "dynamic_range_db": _round(f.get("dynamic_range_db"), 1),
        "centroid_hz": _round(f.get("centroid_hz"), 0),
        "seconds": _round(f.get("seconds"), 0),
    }


def _round(value, digits: int):
    if isinstance(value, (int, float)) and math.isfinite(value):
        return round(float(value), digits)
    return None


def blend(
    primary: List[float], primary_weight: float, secondary: List[float]
) -> List[float]:
    """Weighted mix of two mood vectors."""
    w = max(0.0, min(1.0, primary_weight))
    return [round(w * p + (1.0 - w) * s, 4) for p, s in zip(primary, secondary)]


def usable(confidence: float) -> bool:
    return confidence >= MIN_USABLE_CONFIDENCE


def mood_distance(a: List[float], b: List[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def as_pair(vector: List[float], known: bool) -> Tuple[List[float], bool]:
    return vector, known
