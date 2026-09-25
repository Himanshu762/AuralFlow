"use client";

import { useEffect, useMemo, useRef, useCallback } from "react";
import {
  usePlayerStore,
  type Track,
  type StreamInfo,
  type ImportState,
  type EqState,
  type ArtistDetail,
  type PlayerState,
} from "../stores/playerStore";
import { scoreTracksAI, submitFeedback, computeMood } from "../lib/api";

/* Point a phone or tablet at a Monochrome instance on the LAN by setting
   NEXT_PUBLIC_MONOCHROME_URL at build time; defaults to the local sidecar. */
const MONOCHROME_URL =
  process.env.NEXT_PUBLIC_MONOCHROME_URL || "http://localhost:5173";

/* Monochrome no longer ships a playback service. Supply an endpoint you are
   entitled to use and playback turns on; leave these unset and the app stays
   search-and-browse only. */
const PLAYBACK_API_BASE = process.env.NEXT_PUBLIC_PLAYBACK_API_BASE || "";
const PLAYBACK_API_TOKEN = process.env.NEXT_PUBLIC_PLAYBACK_API_TOKEN || "";

/**
 * Monochrome bridge hook.
 *
 * Manages the hidden iframe that runs the Monochrome audio engine. Commands go
 * out over postMessage; engine events are written straight into the Zustand
 * store. Repeat, shuffle, quality and spatial rendering are owned by the
 * engine — the shell mirrors its own state onto it rather than emulating them.
 */
/* ------------------------------------------------------------------ */
/* Stall detection                                                     */
/* ------------------------------------------------------------------ */

/**
 * Notice when playback claims to be running but is not.
 *
 * On Linux the webview decodes through GStreamer. With the wrong plugins
 * installed it happily reports a playing media element that never advances and
 * never errors — no sound, no message, nothing to search for. It is
 * indistinguishable from the app hanging, so watch the clock and say what is
 * actually wrong.
 */
const STALL_AFTER_MS = 6000;

let lastPosition = -1;
let movedAt = 0;

const STALL_HINT =
  typeof navigator !== "undefined" && /Linux/.test(navigator.platform)
    ? "The player is running but no audio is coming out. This is usually missing GStreamer plugins — the webview decodes through them. Try installing gst-plugins-good and gst-plugins-base."
    : "The player is running but the track is not advancing.";

function noteProgress(isPlaying: boolean, position: number) {
  const store = usePlayerStore.getState();

  if (!isPlaying) {
    lastPosition = -1;
    if (store.stalled) store.setStalled(null);
    return;
  }

  const now = Date.now();
  if (position !== lastPosition) {
    lastPosition = position;
    movedAt = now;
    if (store.stalled) store.setStalled(null);
    return;
  }

  /* Playing, but the position has not moved since we started watching. */
  if (movedAt === 0) {
    movedAt = now;
    return;
  }
  if (now - movedAt > STALL_AFTER_MS && !store.stalled) {
    store.setStalled(STALL_HINT);
  }
}

export function useMonochrome() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playStartRef = useRef<number>(0);
  const lastTrackRef = useRef<string | null>(null);

  /* ---- Send a command to the engine ---- */
  const send = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({ type: `af:${type}`, ...payload }, "*");
  }, []);

  /* ---- Engine events ---- */
  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (!e.data || typeof e.data.type !== "string" || !e.data.type.startsWith("af:")) return;
      const type = e.data.type.slice(3);
      const data = e.data;
      const s = usePlayerStore.getState();

      switch (type) {
        case "ready":
          usePlayerStore.setState({
            monoReady: true,
            playbackConfigured: Boolean(data.playbackConfigured),
          });
          /* Hand the engine a playback endpoint if one is configured. */
          if (PLAYBACK_API_BASE && PLAYBACK_API_TOKEN) {
            send("playbackconfig", { baseUrl: PLAYBACK_API_BASE, token: PLAYBACK_API_TOKEN });
          }
          send("getstate");
          break;

        case "playbackconfig":
          usePlayerStore.setState({ playbackConfigured: Boolean(data.configured) });
          break;

        case "spectrum": {
          /* Live FFT from the engine's analyser — ten normalised bands, plus
             the window RMS used to build the measured waveform. */
          if (Array.isArray(data.levels)) {
            s.setSpectrum(data.levels as number[]);
            if (typeof data.rms === "number") {
              s.recordWaveform(data.position || 0, data.duration || 0, data.rms);
            }
          }
          break;
        }

        case "timeupdate": {
          const position = Number(data.currentTime) || 0;
          const isPlaying = !data.paused;
          usePlayerStore.setState({
            currentTime: position,
            duration: Number(data.duration) || 0,
            playing: isPlaying,
          });
          noteProgress(isPlaying, position);
          break;
        }

        case "trackloaded": {
          const track = data.track as Track | null;
          if (!track) break;

          usePlayerStore.setState({
            track,
            duration: data.duration || 0,
            streamInfo: (data.streamInfo as StreamInfo) ?? null,
          });
          /* A new track means a fresh envelope to measure. */
          s.resetWaveform();
          s.addToRecentlyPlayed(track);

          /* Report how the previous track was received, so the agent learns.
             Adaptive Flow off stops new signals reaching it. */
          if (s.settings.adaptiveDj && lastTrackRef.current && lastTrackRef.current !== track.id) {
            const elapsed = Date.now() - playStartRef.current;
            const prev = s.recentlyPlayed.find((t) => t.id === lastTrackRef.current);
            if (prev) {
              const totalMs = (prev.duration || 180) * 1000;
              submitFeedback({
                trackId: prev.id,
                moodVector: prev.mood_vector || [0.5, 0.5, 0.5, 0.5, 0.5],
                currentMood: s.currentMood,
                recentMoods: s.recentMoods,
                wasPlayedFully: elapsed > totalMs * 0.8,
                wasSkipped: elapsed < totalMs * 0.2,
                wasLiked: s.liked.has(prev.id),
                wasReplayed: false,
                playDurationMs: elapsed,
                totalDurationMs: totalMs,
              }).catch(() => {});
            }
          }

          playStartRef.current = Date.now();
          lastTrackRef.current = track.id;

          /* Map the new track into the 5-D mood space. */
          computeMood({
            id: track.id,
            title: track.title,
            artist: track.artist,
            genre: track.genre,
          })
            .then((result) => {
              if (!result) return;
              usePlayerStore.setState((prev) => ({
                track: prev.track
                  ? { ...prev.track, mood_vector: result.mood_vector, mood_label: result.mood_label }
                  : null,
              }));
              const st = usePlayerStore.getState();
              st.addRecentMood(result.mood_vector);
              st.setCurrentMood(result.mood_vector);
            })
            .catch(() => {});
          break;
        }

        case "statechange":
          usePlayerStore.setState({
            playing: data.state === "playing",
            loading: data.state === "loading",
          });
          if (data.state !== "playing") {
            s.setSpectrum(new Array(10).fill(0));
          }
          if (data.state === "ended") {
            /* The engine applies its own repeat / shuffle here. */
            send("next");
          }
          break;

        case "searchresults": {
          const results = (data.results || []) as Track[];
          usePlayerStore.setState({ searchResults: results, searching: false });

          if (results.length > 0) {
            scoreTracksAI(results, s.currentMood, s.recentMoods)
              .then((scored) => {
                if (scored.recommendations.length === 0) return;
                /* Mood affinity, bounded 0..1. Absent when the track carried
                   no genre to read a mood from — leave those out of the map
                   entirely rather than scoring them zero, so the UI can say
                   nothing instead of claiming no affinity. */
                const scores = new Map<string, number>();
                scored.recommendations.forEach((r) => {
                  if (typeof r.match === "number") scores.set(r.id, r.match);
                });
                /* The agent ranks every candidate by Q-value whether or not a
                   mood could be read, so keep its order for the lists. */
                usePlayerStore.setState({
                  aiScores: scores,
                  aiRanking: scored.recommendations.map((r) => r.id),
                });
                if (scored.predicted_mood) {
                  usePlayerStore.setState({ currentMood: scored.predicted_mood });
                }
              })
              .catch(() => {});
          }
          break;
        }

        case "state":
          usePlayerStore.setState({
            track: (data.currentTrack as Track) || null,
            currentTime: data.currentTime || 0,
            duration: data.duration || 0,
            playing: !data.paused,
            streamInfo: (data.streamInfo as StreamInfo) ?? null,
          });
          break;

        case "instances": {
          const payload = data as unknown as NonNullable<PlayerState["instances"]>;
          usePlayerStore.getState().setInstances({
            discovered: payload.discovered,
            user: payload.user,
          });
          if (data.playbackConfigured !== undefined) {
            usePlayerStore.setState({ playbackConfigured: Boolean(data.playbackConfigured) });
          }
          break;
        }

        case "album":
          usePlayerStore.getState().setAlbumDetail({
            id: String(data.id ?? ""),
            title: String(data.title ?? ""),
            artist: String(data.artist ?? ""),
            cover: String(data.cover ?? ""),
            year: (data.year as number | null) ?? null,
            tracks: (data.tracks || []) as Track[],
            error: data.error ? String(data.error) : undefined,
          });
          break;

        case "artist":
          usePlayerStore.getState().setArtistDetail({
            id: String(data.id ?? ""),
            name: String(data.name ?? ""),
            cover: String(data.cover ?? ""),
            tracks: (data.tracks || []) as Track[],
            albums: (data.albums || []) as ArtistDetail["albums"],
            error: data.error ? String(data.error) : undefined,
          });
          break;

        case "download":
          usePlayerStore.getState().setDownload({
            state: (data.state as "idle" | "started" | "done" | "error") ?? "idle",
            count: Number(data.count ?? 0),
            title: String(data.title ?? ""),
            message: String(data.message ?? ""),
          });
          break;

        case "lyrics":
          usePlayerStore.getState().setLyrics({
            trackId: (data.trackId as string) ?? null,
            lines: (data.lines || []) as { time: number; text: string }[],
            plain: String(data.plain ?? ""),
            synced: Boolean(data.synced),
          });
          break;

        case "queue":
          usePlayerStore
            .getState()
            .setQueue((data.tracks || []) as Track[], Number(data.index ?? -1));
          break;

        case "eqpresets":
          usePlayerStore
            .getState()
            .setEqPresets((data.presets || []) as PlayerState["eqPresets"]);
          break;

        case "autoeqlist":
          usePlayerStore.getState().setAutoEq({
            headphones: (data.headphones || []) as PlayerState["autoEq"]["headphones"],
            targets: (data.targets || []) as PlayerState["autoEq"]["targets"],
            searching: false,
          });
          break;

        case "autoeq":
          usePlayerStore.getState().setAutoEq({
            applied: data.applied ? `${data.headphone} → ${data.target}` : null,
            message: data.applied
              ? `${data.bands} bands applied`
              : String(data.message ?? "Could not apply that correction."),
          });
          break;

        case "offline":
          usePlayerStore.getState().setOffline({
            tracks: (data.tracks || []) as Track[],
            error: data.error ? String(data.error) : null,
            loaded: true,
          });
          break;

        case "eqstate":
          usePlayerStore.getState().setEq(data as unknown as EqState);
          break;

        case "importprogress":
          usePlayerStore.getState().setImportState({
            running: true,
            current: Number(data.current) || 0,
            total: Number(data.total) || 0,
            item: String(data.item ?? ""),
          });
          break;

        case "importdone": {
          const store = usePlayerStore.getState();
          if (data.error) {
            store.setImportState({ running: false, done: true, error: String(data.error) });
            break;
          }
          const matched = (data.tracks || []) as Track[];
          const playlists = (data.playlists || []) as { name: string; tracks: Track[] }[];
          store.setImportState({
            running: false,
            done: true,
            error: null,
            matched,
            playlists,
            missing: (data.missing || []) as ImportState["missing"],
          });
          /* Save whatever the file described as real playlists. A file with no
             playlist column still yields one list, named after the file. */
          const lists =
            playlists.length > 0
              ? playlists
              : matched.length > 0
                ? [{ name: store.importState.sourceName || "Imported", tracks: matched }]
                : [];
          lists.forEach((pl) => {
            if (pl.tracks.length > 0) {
              store.createPlaylist(pl.name, pl.tracks, store.importState.sourceName || "import");
            }
          });
          break;
        }

        case "error":
          console.warn(`[engine] ${data.scope}: ${data.message}`);
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [send]);

  /* ---- Public API ---- */
  /* Memoized so consumers can safely use it as an effect dependency. */
  return useMemo(
    () => ({
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
        const clamped = Math.max(0, Math.min(1, level));
        usePlayerStore.setState({ volume: clamped, muted: clamped === 0 });
        send("volume", { level: clamped });
      },
      /* Mute without losing the user's level, so unmuting restores it. */
      setMuted: (muted: boolean) => {
        const { volume } = usePlayerStore.getState();
        usePlayerStore.setState({ muted });
        send("volume", { level: muted ? 0 : volume });
      },
      /** Change the stream tier the engine requests. */
      setQuality: (tier: string) => send("quality", { tier }),
      /** Enable or disable the engine's binaural / head-tracked rendering. */
      setSpatial: (enabled: boolean) => send("spatial", { enabled }),
      /** Repeat mode is owned by the engine so queue-end wrapping works. */
      setRepeat: (mode: string) => send("repeat", { mode }),
      /** Shuffle is owned by the engine so its preloading stays consistent. */
      setShuffle: (enabled: boolean) => send("shuffle", { enabled }),
      /**
       * Save a track — or the whole queue — to the music folder.
       *
       * The engine does the work: it fetches the stream, transcodes if the
       * chosen format needs it, and writes tags and cover art. The native
       * shell decides where the file lands.
       */
      download: (opts: { trackId?: string; scope?: "track" | "queue"; quality?: string }) =>
        send("download", opts),
      setDownloadQuality: (quality: string) => send("downloadquality", { quality }),
      /** Point the engine at a streaming endpoint. Empty values clear it. */
      setPlaybackConfig: (baseUrl: string, token: string) =>
        send("playbackconfig", { baseUrl, token }),
      /**
       * Read or change the backends the engine talks to.
       *
       * This build ships with an empty instance list, so without a user-supplied
       * entry there is no streaming backend and nothing can play.
       */
      instances: (opts: {
        add?: { url: string; type: "api" | "streaming" }[];
        remove?: { url: string; type: "api" | "streaming" }[];
        refresh?: boolean;
      } = {}) => send("instances", opts),
      /** Fetch a real album from the catalogue by its id. */
      getAlbum: (id: string) => send("album", { id }),
      /** Fetch a real artist from the catalogue by their id. */
      getArtist: (id: string) => send("artist", { id }),
      /** Fetch lyrics for whatever is playing. */
      getLyrics: () => send("lyrics"),
      /* ---- Queue. This is the engine's own queue, so what the list shows
         and what plays next cannot drift apart. ---- */
      getQueue: () => send("queue"),
      /** Append tracks, or drop them in right after the current one. */
      queueAdd: (tracks: Track[], next = false) => send("queueadd", { tracks, next }),
      queueRemove: (index: number) => send("queueremove", { index }),
      /** Reorder by dragging. */
      queueMove: (from: number, to: number) => send("queuemove", { from, to }),
      queueClear: () => send("queueclear"),
      /** Jump straight to a position in the queue. */
      queuePlay: (index: number) => send("queueplay", { index }),
      /** Ask the engine to prefer the Atmos master where one exists. */
      setPreferAtmos: (enabled: boolean) => send("atmos", { enabled }),
      /** Preset curves, sized to the running band count. */
      getEqPresets: () => send("eqpresets"),
      /** Search AutoEQ's headphone database; empty query returns popular ones. */
      searchHeadphones: (query = "") => {
        usePlayerStore.getState().setAutoEq({ searching: true });
        send("autoeqlist", { query });
      },
      /** Apply a headphone correction toward a target curve. */
      applyAutoEq: (headphone: PlayerState["autoEq"]["headphones"][number], target: string) =>
        send("autoeqapply", { headphone, target }),
      /** List what has been downloaded to the music folder. */
      getOffline: () => send("offline"),
      /** Play a downloaded file through the normal pipeline. */
      playOffline: (trackId: string, tracks: Track[]) =>
        send("playoffline", { trackId, tracks }),
      /** Ask the engine for the current equaliser state. */
      getEqState: () => send("eqstate"),
      /** Switch the equaliser chain on or off. */
      setEqEnabled: (enabled: boolean) => send("eq", { enabled }),
      /** Set the whole curve. Doing this by hand stops the stabiliser. */
      setEqGains: (gains: number[]) => send("eq", { gains }),
      /** Output trim applied before the bands, in dB. */
      setEqPreamp: (preamp: number) => send("eq", { preamp }),
      /**
       * The adaptive stabiliser: measures what is playing and corrects its
       * balance toward the record's own average, so tracks stop jumping in
       * tone across a shuffled library.
       */
      setAdaptiveEq: (opts: { enabled: boolean; tilt?: number; strength?: number }) =>
        send("adaptiveeq", opts),
      /**
       * Bring a library across from another service.
       *
       * The engine resolves each row against its own catalogue — exactly when
       * the export carries an ISRC, by title and artist otherwise — and paces
       * itself to stay under the catalogue's rate limit, so a long playlist
       * takes a while. Progress arrives as `importprogress`.
       */
      importLibrary: (text: string, format: string, sourceName: string) => {
        usePlayerStore.getState().setImportState({
          running: true,
          done: false,
          error: null,
          current: 0,
          total: 0,
          item: "",
          matched: [],
          missing: [],
          playlists: [],
          sourceName,
        });
        send("import", { text, format });
      },
    }),
    [send]
  );
}
