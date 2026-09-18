"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePlayerStore, type Track } from "../stores/playerStore";
import { scoreTracksAI, submitFeedback, computeMood } from "../lib/api";

const MONOCHROME_URL = "http://localhost:5173";

/**
 * Monochrome Bridge Hook
 *
 * Manages the hidden iframe that runs the Monochrome music engine.
 * All playback commands go through postMessage; all state updates
 * are written directly to the Zustand store.
 */
export function useMonochrome() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playStartRef = useRef<number>(0);
  const lastTrackRef = useRef<string | null>(null);

  const store = usePlayerStore();

  /* ---- Send command to Monochrome ---- */
  const send = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({ type: `af:${type}`, ...payload }, "*");
  }, []);

  /* ---- Message handler ---- */
  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (!e.data || typeof e.data.type !== "string" || !e.data.type.startsWith("af:")) return;
      const type = e.data.type.slice(3);
      const data = e.data;
      const s = usePlayerStore.getState();

      switch (type) {
        case "ready":
          usePlayerStore.setState({ monoReady: true });
          send("getstate");
          break;

        case "timeupdate":
          usePlayerStore.setState({
            currentTime: data.currentTime || 0,
            duration: data.duration || 0,
            playing: !data.paused,
          });
          break;

        case "trackloaded": {
          const track = data.track as Track;
          usePlayerStore.setState({ track, duration: data.duration || 0 });

          // Record play start time
          playStartRef.current = Date.now();

          // Add to recently played
          if (track) {
            usePlayerStore.getState().addToRecentlyPlayed(track);
          }

          // Submit feedback for the previous track (if any)
          if (lastTrackRef.current && lastTrackRef.current !== track?.id) {
            const elapsed = Date.now() - playStartRef.current;
            const prevTrack = s.recentlyPlayed.find((t) => t.id === lastTrackRef.current);
            if (prevTrack) {
              submitFeedback({
                trackId: prevTrack.id,
                moodVector: prevTrack.mood_vector || [0.5, 0.5, 0.5, 0.5, 0.5],
                currentMood: s.currentMood,
                recentMoods: s.recentMoods,
                wasPlayedFully: elapsed > (prevTrack.duration || 180) * 800,
                wasSkipped: elapsed < (prevTrack.duration || 180) * 200,
                wasLiked: s.liked.has(prevTrack.id),
                wasReplayed: false,
                playDurationMs: elapsed,
                totalDurationMs: (prevTrack.duration || 180) * 1000,
              }).catch(() => {});
            }
          }
          lastTrackRef.current = track?.id || null;

          // Compute mood for the new track
          if (track) {
            computeMood({ id: track.id, title: track.title, artist: track.artist, genre: track.genre })
              .then((result) => {
                if (result) {
                  usePlayerStore.setState((prev) => ({
                    track: prev.track ? { ...prev.track, mood_vector: result.mood_vector, mood_label: result.mood_label } : null,
                  }));
                  usePlayerStore.getState().addRecentMood(result.mood_vector);
                  usePlayerStore.getState().setCurrentMood(result.mood_vector);
                }
              })
              .catch(() => {});
          }
          break;
        }

        case "statechange":
          usePlayerStore.setState({
            playing: data.state === "playing",
            loading: data.state === "loading",
          });
          if (data.state === "ended") {
            send("next");
          }
          break;

        case "searchresults": {
          const results = (data.results || []) as Track[];
          usePlayerStore.setState({ searchResults: results, searching: false });

          // Score results with AI (fire and forget)
          if (results.length > 0) {
            scoreTracksAI(results, s.currentMood, s.recentMoods)
              .then((scored) => {
                if (scored.recommendations.length > 0) {
                  const scores = new Map<string, number>();
                  scored.recommendations.forEach((r) => {
                    scores.set(r.id, r.confidence);
                  });
                  usePlayerStore.setState({ aiScores: scores });
                  if (scored.predicted_mood) {
                    usePlayerStore.setState({ currentMood: scored.predicted_mood });
                  }
                }
              })
              .catch(() => {});
          }
          break;
        }

        case "state":
          usePlayerStore.setState({
            track: data.currentTrack || null,
            currentTime: data.currentTime || 0,
            duration: data.duration || 0,
            playing: !data.paused,
          });
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [send]);

  /* ---- Public API ---- */
  return {
    iframeRef,
    iframeSrc: MONOCHROME_URL,
    search: (query: string) => {
      usePlayerStore.setState({ searching: true, searchQuery: query });
      send("search", { query });
    },
    play: (trackId: string, tracks: Track[], searchQuery: string) => {
      send("play", { trackId, tracks, searchQuery });
    },
    toggle: () => send("toggle"),
    next: () => send("next"),
    prev: () => send("prev"),
    seek: (time: number) => send("seek", { time }),
    volume: (level: number) => {
      usePlayerStore.setState({ volume: level });
      send("volume", { level });
    },
  };
}
