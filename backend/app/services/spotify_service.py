import spotipy
from spotipy.oauth2 import SpotifyOAuth, SpotifyClientCredentials
from typing import Dict, List, Optional
from app.core.config import settings


class SpotifyService:
    """Service for interacting with Spotify API"""

    def __init__(self):
        self.client_id = settings.SPOTIFY_CLIENT_ID
        self.client_secret = settings.SPOTIFY_CLIENT_SECRET
        self.redirect_uri = settings.SPOTIFY_REDIRECT_URI

    def get_auth_manager(self) -> SpotifyOAuth:
        """Get Spotify OAuth manager"""
        return SpotifyOAuth(
            client_id=self.client_id,
            client_secret=self.client_secret,
            redirect_uri=self.redirect_uri,
            scope="user-read-private user-read-email user-library-read user-top-read user-read-currently-playing user-read-playback-state user-modify-playback-state streaming"
        )

    def get_client(self, access_token: str) -> spotipy.Spotify:
        """Get authenticated Spotify client"""
        return spotipy.Spotify(auth=access_token)

    def get_audio_features(self, spotify_client: spotipy.Spotify, track_id: str) -> Optional[Dict]:
        """
        Get audio features for a track from Spotify API

        Returns a dict with:
        - energy: 0.0 to 1.0
        - valence: 0.0 to 1.0 (happiness)
        - danceability: 0.0 to 1.0
        - tempo: BPM
        - acousticness: 0.0 to 1.0
        - instrumentalness: 0.0 to 1.0
        - speechiness: 0.0 to 1.0
        - loudness: dB
        """
        try:
            features = spotify_client.audio_features([track_id])[0]
            return features
        except Exception as e:
            print(f"Error fetching audio features: {e}")
            return None

    def get_track_info(self, spotify_client: spotipy.Spotify, track_id: str) -> Optional[Dict]:
        """Get track metadata"""
        try:
            track = spotify_client.track(track_id)
            return {
                "id": track["id"],
                "name": track["name"],
                "artist": ", ".join([artist["name"] for artist in track["artists"]]),
                "album": track["album"]["name"],
                "duration_ms": track["duration_ms"],
                "popularity": track["popularity"]
            }
        except Exception as e:
            print(f"Error fetching track info: {e}")
            return None

    def get_recommendations(
        self,
        spotify_client: spotipy.Spotify,
        seed_tracks: List[str] = None,
        seed_artists: List[str] = None,
        seed_genres: List[str] = None,
        target_energy: float = None,
        target_valence: float = None,
        target_danceability: float = None,
        limit: int = 20
    ) -> List[Dict]:
        """
        Get track recommendations from Spotify based on seeds and target features

        This is key for the mood-based recommendation system
        """
        try:
            params = {
                "limit": limit
            }

            if seed_tracks:
                params["seed_tracks"] = seed_tracks[:5]  # Max 5
            if seed_artists:
                params["seed_artists"] = seed_artists[:5]
            if seed_genres:
                params["seed_genres"] = seed_genres[:5]

            # Target audio features for mood matching
            if target_energy is not None:
                params["target_energy"] = target_energy
            if target_valence is not None:
                params["target_valence"] = target_valence
            if target_danceability is not None:
                params["target_danceability"] = target_danceability

            recommendations = spotify_client.recommendations(**params)

            return [
                {
                    "id": track["id"],
                    "name": track["name"],
                    "artist": ", ".join([artist["name"] for artist in track["artists"]]),
                    "uri": track["uri"]
                }
                for track in recommendations["tracks"]
            ]
        except Exception as e:
            print(f"Error fetching recommendations: {e}")
            return []

    def get_user_top_tracks(
        self,
        spotify_client: spotipy.Spotify,
        time_range: str = "medium_term",
        limit: int = 20
    ) -> List[Dict]:
        """
        Get user's top tracks
        time_range: short_term, medium_term, long_term
        """
        try:
            results = spotify_client.current_user_top_tracks(
                time_range=time_range,
                limit=limit
            )
            return [
                {
                    "id": track["id"],
                    "name": track["name"],
                    "artist": ", ".join([artist["name"] for artist in track["artists"]])
                }
                for track in results["items"]
            ]
        except Exception as e:
            print(f"Error fetching top tracks: {e}")
            return []


spotify_service = SpotifyService()
