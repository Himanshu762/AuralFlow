/**
 * API client for the FastAPI backend.
 *
 * Three groups of calls:
 *  - recommendations: score a list, submit feedback, read one track's mood
 *  - library: everything the shell sees goes into the DJ's candidate pool,
 *    along with what the engine measures from the audio
 *  - dj: what plays next, chosen from that pool along the session's arc
 */

import type { Track } from "../stores/playerStore";

/* Override with NEXT_PUBLIC_API_BASE when the backend runs on another host
   (a phone build talking to a desktop on the same network, for example). */
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";

export type MoodSource = "measured" | "artist" | "genre" | "unknown";

export interface MeasuredSummary {
  tempo_bpm: number | null;
  mode: "major" | "minor" | null;
  key: number | null;
  loudness_db: number | null;
  dynamic_range_db: number | null;
  centroid_hz: number | null;
  seconds: number | null;
}

function timeOfDay(): string {
  const hour = new Date().getHours();
  return hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[AI] ${path} failed:`, res.status);
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Score candidates with the RL agent                                 */
/* ------------------------------------------------------------------ */

export interface ScoreResponse {
  recommendations: Array<
    Track & {
      /** Raw Q-value from the policy net: ranks candidates, not a percentage. */
      confidence: number;
      /** Null when the track carried no mood to read. */
      mood_distance: number | null;
      /**
       * Bounded 0..1 mood affinity — what the UI shows as a match %.
       * Null when there was no mood to compare against.
       */
      match: number | null;
      mood_source: MoodSource;
      mood_confidence: number;
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
  targetMood: number[] | null = null,
  numRecommendations: number = 40
): Promise<ScoreResponse> {
  const res = await post<ScoreResponse>("/recommendations/score", {
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
    target_mood: targetMood,
    time_of_day: timeOfDay(),
    device_type: "desktop",
    num_recommendations: numRecommendations,
  });
  return res ?? { recommendations: [], predicted_mood: null, count: 0 };
}

/* ------------------------------------------------------------------ */
/* Feedback: how a track was received                                 */
/* ------------------------------------------------------------------ */

export interface ListenerState {
  currentMood: number[];
  recentMoods: number[][];
  targetMood?: number[] | null;
}

export interface FeedbackPayload {
  trackId: string;
  moodVector: number[];
  state: ListenerState;
  /** The listener's state when the following track started, if known. */
  nextState?: ListenerState | null;
  /** The mood of the track that actually played next. */
  nextMoodVector?: number[] | null;
  wasPlayedFully: boolean;
  wasSkipped: boolean;
  wasLiked: boolean;
  wasReplayed: boolean;
  playDurationMs: number;
  totalDurationMs: number;
}

function stateBody(s: ListenerState) {
  return {
    current_mood: s.currentMood,
    recent_moods: s.recentMoods,
    target_mood: s.targetMood ?? null,
    time_of_day: timeOfDay(),
    device_type: "desktop",
  };
}

export async function submitFeedback(payload: FeedbackPayload): Promise<{ success: boolean; reward: number }> {
  const res = await post<{ success: boolean; reward: number }>("/recommendations/feedback", {
    track_id: payload.trackId,
    song_mood_vector: payload.moodVector,
    state: stateBody(payload.state),
    next_state: payload.nextState ? stateBody(payload.nextState) : null,
    next_song_mood_vector: payload.nextMoodVector ?? null,
    was_played_fully: payload.wasPlayedFully,
    was_skipped: payload.wasSkipped,
    was_liked: payload.wasLiked,
    was_replayed: payload.wasReplayed,
    play_duration_ms: payload.playDurationMs,
    total_duration_ms: payload.totalDurationMs,
  });
  return res ?? { success: false, reward: 0 };
}

/* ------------------------------------------------------------------ */
/* One track's mood                                                   */
/* ------------------------------------------------------------------ */

export interface MoodResponse {
  track_id: string;
  mood_vector: number[];
  mood_label: string;
  mood_source: MoodSource;
  mood_confidence: number;
  measured: MeasuredSummary | null;
}

export async function computeMood(
  track: Pick<Track, "id" | "title" | "artist" | "genre">
): Promise<MoodResponse | null> {
  return post<MoodResponse>("/recommendations/mood", {
    id: track.id,
    title: track.title,
    artist: track.artist,
    genre: track.genre || "",
  });
}

/* ------------------------------------------------------------------ */
/* Library                                                            */
/* ------------------------------------------------------------------ */

export interface LibraryStats {
  tracks: number;
  measured: number;
  artist_prior: number;
  genre: number;
  unknown: number;
  liked: number;
  played: number;
  artists: number;
}

export async function upsertLibrary(tracks: Track[], source: string): Promise<LibraryStats | null> {
  if (tracks.length === 0) return null;
  const res = await post<{ stored: number; stats: LibraryStats }>("/library/tracks", {
    source,
    tracks: tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      artistId: t.artistId ?? null,
      album: t.album || "",
      albumId: t.albumId ?? null,
      genre: t.genre || "",
      duration: t.duration || 0,
      cover: t.cover || "",
      coverLarge: t.coverLarge || "",
      audioQuality: t.audioQuality || "",
      audioModes: t.audioModes ?? [],
    })),
  });
  return res?.stats ?? null;
}

export interface FeaturesResponse extends MoodResponse {
  stored: boolean;
}

/** What the engine measured from the audio so far. */
export async function postFeatures(
  trackId: string,
  seconds: number,
  features: Record<string, unknown>,
  final: boolean
): Promise<FeaturesResponse | null> {
  return post<FeaturesResponse>("/library/features", { track_id: trackId, seconds, features, final });
}

export async function postLibraryEvent(trackId: string, event: "play" | "like" | "unlike"): Promise<void> {
  await post("/library/event", { track_id: trackId, event });
}

export async function fetchLibraryStats(): Promise<LibraryStats | null> {
  try {
    const res = await fetch(`${API_BASE}/library/stats`);
    if (!res.ok) return null;
    return (await res.json()) as LibraryStats;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* The DJ                                                             */
/* ------------------------------------------------------------------ */

export type FlowMode = "hold" | "drift" | "lift" | "settle" | "focus" | "custom";

export interface DjPick extends Track {
  mood_vector: number[];
  mood_source: MoodSource;
  mood_confidence: number;
  mood_label: string;
  mood_known: boolean;
  play_count: number;
  liked: boolean;
  q_value: number;
  /** 0..1 fit to the arc's target mood; null when the mood is unknown. */
  fit: number | null;
  score: number;
  measured?: MeasuredSummary | null;
}

export interface DjNextResponse {
  pick: DjPick | null;
  alternates: DjPick[];
  target: number[];
  mode: FlowMode;
  reason: string;
  pool_size: number;
  exploring: boolean;
  policy_weight: number;
  library: LibraryStats;
}

export async function djNext(body: {
  currentMood: number[];
  recentMoods: number[][];
  mode: FlowMode;
  customTarget: number[] | null;
  position: number;
  horizon: number;
  currentTrack: Track | null;
  excludeIds: string[];
}): Promise<DjNextResponse | null> {
  return post<DjNextResponse>("/dj/next", {
    current_mood: body.currentMood,
    recent_moods: body.recentMoods,
    mode: body.mode,
    custom_target: body.customTarget,
    position: body.position,
    horizon: body.horizon,
    current_track: body.currentTrack ? { id: body.currentTrack.id, artist: body.currentTrack.artist } : null,
    exclude_ids: body.excludeIds,
    time_of_day: timeOfDay(),
    device_type: "desktop",
  });
}

export async function djReject(trackId: string, moodVector: number[], state: ListenerState): Promise<void> {
  await post("/dj/reject", { track_id: trackId, song_mood_vector: moodVector, state: stateBody(state) });
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
