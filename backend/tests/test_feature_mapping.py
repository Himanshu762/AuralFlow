"""Measured audio features map to a sane, bounded mood vector."""

from app.services import feature_service


def _features(**overrides):
    base = {
        "seconds": 60,
        "frames": 1200,
        "loudness_db": -18.0,
        "crest_db": 12.0,
        "dynamic_range_db": 9.0,
        "centroid_hz": 1800.0,
        "flatness": 0.12,
        "flux": 0.2,
        "tempo_bpm": 120.0,
        "beat_strength": 0.5,
        "mode_major": 0.5,
        "vocal_ratio": 0.35,
        "vocal_modulation": 0.01,
        "hf_ratio": 0.08,
        "lf_ratio": 0.2,
    }
    base.update(overrides)
    return base


def test_vector_is_five_bounded_dimensions():
    vec = feature_service.mood_from_features(_features())
    assert len(vec) == 5
    assert all(0.0 <= v <= 1.0 for v in vec)


def test_louder_busier_signal_reads_as_more_energetic():
    quiet = feature_service.mood_from_features(_features(loudness_db=-32, flux=0.05, tempo_bpm=70))
    loud = feature_service.mood_from_features(_features(loudness_db=-9, flux=0.4, tempo_bpm=150))
    assert loud[0] > quiet[0]


def test_major_bright_fast_reads_as_higher_valence():
    minor = feature_service.mood_from_features(_features(mode_major=0.1, centroid_hz=900, tempo_bpm=75))
    major = feature_service.mood_from_features(_features(mode_major=0.9, centroid_hz=3000, tempo_bpm=140))
    assert major[1] > minor[1]


def test_strong_beat_in_dance_range_is_danceable():
    loose = feature_service.mood_from_features(_features(beat_strength=0.1, tempo_bpm=60, lf_ratio=0.05))
    tight = feature_service.mood_from_features(_features(beat_strength=0.9, tempo_bpm=124, lf_ratio=0.3))
    assert tight[2] > loose[2]


def test_dynamic_unflat_signal_reads_as_acoustic():
    electronic = feature_service.mood_from_features(_features(flatness=0.3, crest_db=7, dynamic_range_db=4, hf_ratio=0.2))
    acoustic = feature_service.mood_from_features(_features(flatness=0.03, crest_db=18, dynamic_range_db=16, hf_ratio=0.03))
    assert acoustic[3] > electronic[3]


def test_modulated_vocal_band_lowers_instrumentalness():
    instrumental = feature_service.mood_from_features(_features(vocal_ratio=0.15, vocal_modulation=0.001))
    vocal = feature_service.mood_from_features(_features(vocal_ratio=0.55, vocal_modulation=0.03))
    assert instrumental[4] > vocal[4]


def test_missing_features_fall_back_to_the_middle():
    vec = feature_service.mood_from_features({})
    assert all(0.2 <= v <= 0.8 for v in vec)


def test_confidence_grows_with_audio_heard():
    assert feature_service.confidence_for(0, 0) == 0.0
    assert feature_service.confidence_for(10, 200) < feature_service.confidence_for(40, 800)
    assert feature_service.confidence_for(120, 2400) == 1.0
    assert not feature_service.usable(feature_service.confidence_for(5, 100))
    assert feature_service.usable(feature_service.confidence_for(30, 600))
