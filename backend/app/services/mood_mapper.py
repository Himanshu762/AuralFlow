from typing import List, Tuple

# 5D Mood Vector: [energy, valence, danceability, acousticness, instrumentalness]

GENRE_MOOD_MAP = {
    "ambient": [0.1, 0.4, 0.1, 0.9, 0.9],
    "classical": [0.2, 0.3, 0.1, 0.9, 0.9],
    "jazz": [0.4, 0.6, 0.5, 0.8, 0.7],
    "blues": [0.4, 0.4, 0.5, 0.7, 0.3],
    "folk": [0.3, 0.5, 0.4, 0.8, 0.2],
    "lo-fi": [0.2, 0.6, 0.4, 0.8, 0.7],
    "chill": [0.3, 0.6, 0.5, 0.7, 0.5],
    "downtempo": [0.3, 0.5, 0.5, 0.6, 0.6],
    "pop": [0.8, 0.7, 0.8, 0.2, 0.0],
    "dance": [0.9, 0.7, 0.9, 0.1, 0.1],
    "electronic": [0.8, 0.5, 0.8, 0.1, 0.8],
    "techno": [0.9, 0.4, 0.8, 0.0, 0.9],
    "trance": [0.9, 0.5, 0.7, 0.0, 0.8],
    "house": [0.8, 0.6, 0.9, 0.1, 0.7],
    "hip hop": [0.7, 0.5, 0.8, 0.2, 0.0],
    "rap": [0.8, 0.5, 0.8, 0.2, 0.0],
    "rock": [0.8, 0.4, 0.4, 0.1, 0.1],
    "metal": [0.9, 0.2, 0.3, 0.0, 0.2],
    "thrash metal": [0.95, 0.1, 0.2, 0.0, 0.3],
    "indie": [0.6, 0.5, 0.6, 0.4, 0.2],
    "alternative": [0.7, 0.4, 0.5, 0.2, 0.2],
    "country": [0.6, 0.6, 0.5, 0.6, 0.1],
    "r&b": [0.5, 0.6, 0.7, 0.3, 0.1],
    "soul": [0.5, 0.6, 0.6, 0.4, 0.1],
    "funk": [0.7, 0.7, 0.8, 0.3, 0.2],
    "reggae": [0.6, 0.7, 0.8, 0.4, 0.1],
    "world": [0.5, 0.5, 0.6, 0.7, 0.5],
}

DEFAULT_MOOD = [0.5, 0.5, 0.5, 0.5, 0.5]

def resolve_mood(genre: str) -> Tuple[List[float], bool]:
    """
    Map a genre string to a 5D mood vector heuristically.

    Returns the vector and whether it was actually derived from the genre.
    That second value matters: a track we know nothing about falls back to the
    neutral centre of the space, which sits zero distance from any listener
    mood and would otherwise be reported as a perfect match. Callers use the
    flag to say "no reading" instead of inventing a confident one.
    """
    if not genre:
        return DEFAULT_MOOD, False

    genre_lower = genre.lower().strip()

    # Exact match
    if genre_lower in GENRE_MOOD_MAP:
        return GENRE_MOOD_MAP[genre_lower], True

    # Partial match
    for key, vector in GENRE_MOOD_MAP.items():
        if key in genre_lower:
            return vector, True

    return DEFAULT_MOOD, False


def get_mood_vector(genre: str) -> List[float]:
    """The vector alone, for callers that do not care how it was arrived at."""
    return resolve_mood(genre)[0]
