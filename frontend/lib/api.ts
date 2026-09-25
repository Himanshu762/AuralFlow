/**
 * API client for the FastAPI backend.
 * Connects the frontend to the RL recommendation engine.
 */

import type { Track } from "../stores/playerStore";

/* Override with NEXT_PUBLIC_API_BASE when the backend runs on another host
   (a phone build talking to a desktop on the same network, for example). */
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";

/* ------------------------------------------------------------------ */
/* Score candidates with the RL agent                                 */
/* ------------------------------------------------------------------ */

export interface ScoreResponse {
  recommendations: Array<
    Track & {
      /** Raw Q-value from the policy net: ranks candidates, not a percentage. */
      confidence: number;
      /** Null when the track carried no genre to read a mood from. */
      mood_distance: number | null;
      /**
       * Bounded 0..1 mood affinity — what the UI shows as a match %.
       * Null when there was no mood to compare against; show nothing rather
       * than a number, since the neutral fallback would read as 100%.
       */
      match: number | null;
      predicted_mood: number[];
    }
  >;
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

/* ------------------------------------------------------------------ */
/* RL agent training status (sidebar "AI DJ" indicator)               */
/* ------------------------------------------------------------------ */

export interface AiStatsResponse {
  explorationRate: number;
  memorySize: number;
  trainingSteps: number;
  lastReward: number | null;
  online: boolean;
}

const OFFLINE_STATS: AiStatsResponse = {
  explorationRate: 0.3,
  memorySize: 0,
  trainingSteps: 0,
  lastReward: null,
  online: false,
};

export async function fetchAiStats(): Promise<AiStatsResponse> {
  try {
    const res = await fetch(`${API_BASE}/recommendations/stats`);
    if (!res.ok) return OFFLINE_STATS;
    const data = await res.json();
    return {
      explorationRate: data.exploration_rate ?? 0.3,
      memorySize: data.memory_size ?? 0,
      trainingSteps: data.training_steps ?? 0,
      lastReward: data.last_reward ?? null,
      online: true,
    };
  } catch {
    /* Backend not running — the UI degrades to "AI DJ Offline". */
    return OFFLINE_STATS;
  }
}
