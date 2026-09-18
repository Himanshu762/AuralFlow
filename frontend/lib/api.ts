/**
 * API client for the FastAPI backend.
 * Connects the frontend to the RL recommendation engine.
 */

import type { Track } from "../stores/playerStore";

const API_BASE = "http://localhost:8000/api/v1";

/* ------------------------------------------------------------------ */
/* Score candidates with the RL agent                                 */
/* ------------------------------------------------------------------ */

export interface ScoreResponse {
  recommendations: Array<Track & { confidence: number; mood_distance: number; predicted_mood: number[] }>;
  predicted_mood: number[] | null;
  count: number;
}

export async function scoreTracksAI(
  candidates: Track[],
  currentMood: number[],
  recentMoods: number[][] = [],
  timeOfDay?: string,
  numRecommendations: number = 20
): Promise<ScoreResponse> {
  const hour = new Date().getHours();
  const tod = timeOfDay || (hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening");

  const res = await fetch(`${API_BASE}/recommendations/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidates: candidates.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        genre: t.genre || "",
        album: t.album || "",
        duration: t.duration || 0,
        cover_url: t.cover || "",
      })),
      current_mood: currentMood,
      recent_moods: recentMoods,
      time_of_day: tod,
      device_type: "desktop",
      num_recommendations: numRecommendations,
    }),
  });

  if (!res.ok) {
    console.warn("[AI] Score request failed:", res.status);
    return { recommendations: [], predicted_mood: null, count: 0 };
  }

  return res.json();
}

/* ------------------------------------------------------------------ */
/* Submit feedback to train the RL agent                              */
/* ------------------------------------------------------------------ */

export interface FeedbackPayload {
  trackId: string;
  moodVector: number[];
  currentMood: number[];
  recentMoods: number[][];
  wasPlayedFully: boolean;
  wasSkipped: boolean;
  wasLiked: boolean;
  wasReplayed: boolean;
  playDurationMs: number;
  totalDurationMs: number;
}

export async function submitFeedback(payload: FeedbackPayload): Promise<{ success: boolean; reward: number }> {
  try {
    const res = await fetch(`${API_BASE}/recommendations/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        track_id: payload.trackId,
        song_mood_vector: payload.moodVector,
        state: {
          current_mood: payload.currentMood,
          recent_moods: payload.recentMoods,
        },
        was_played_fully: payload.wasPlayedFully,
        was_skipped: payload.wasSkipped,
        was_liked: payload.wasLiked,
        was_replayed: payload.wasReplayed,
        play_duration_ms: payload.playDurationMs,
        total_duration_ms: payload.totalDurationMs,
      }),
    });

    if (!res.ok) {
      console.warn("[AI] Feedback request failed:", res.status);
      return { success: false, reward: 0 };
    }

    return res.json();
  } catch {
    return { success: false, reward: 0 };
  }
}

/* ------------------------------------------------------------------ */
/* Compute mood vector for a single track                             */
/* ------------------------------------------------------------------ */

export async function computeMood(
  track: Pick<Track, "id" | "title" | "artist" | "genre">
): Promise<{ mood_vector: number[]; mood_label: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/recommendations/mood`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: track.id,
        title: track.title,
        artist: track.artist,
        genre: track.genre || "",
      }),
    });

    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
