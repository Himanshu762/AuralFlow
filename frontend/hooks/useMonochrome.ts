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
  type RepeatMode,
} from "../stores/playerStore";
import {
  scoreTracksAI,
  submitFeedback,
  computeMood,
  upsertLibrary,
  postFeatures,
  postLibraryEvent,
  djNext,
  djReject,
  type ListenerState,
  type DjPick,
} from "../lib/api";

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
/* Long enough that a slow start is not mistaken for a dead decoder. */
const STALL_AFTER_MS = 10000;

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

  /* A track that is still resolving its stream reports itself as playing at
     position zero, and can stay there for several seconds on a slow answer.
     That is not a decoder that will never produce sound, and telling someone
     to go and install GStreamer packages because a stream took a moment is
     worse than saying nothing. Only start counting once it is loaded. */
  if (store.loading) {
    movedAt = 0;
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
  /* The listener's state at the moment the current track started. */
  const stateAtStartRef = useRef<ListenerState | null>(null);

  /* ---- Send a command to the engine ---- */
  const send = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({ type: `af:${type}`, ...payload }, "*");
  }, []);

  /* ---- The DJ loop ----
     Every track start: settle the previous track's feedback, read the new
     track's mood, ask the DJ what should follow, and queue it. */
  const askDj = useCallback(
    async (current: Track | null) => {
      const st = usePlayerStore.getState();
      if (!st.settings.adaptiveDj) return null;
      st.setDj({ deciding: true });
      /* Playing from a list queues the whole list behind the track, so the
         queue is not something the DJ chose. Only what is about to play is
         kept out of the running; the pick goes in ahead of the rest. */
      const exclude = [
        ...st.recentlyPlayed.slice(0, 15).map((t) => t.id),
        ...st.dj.rejected,
        ...st.queue.slice(st.queueIndex + 1, st.queueIndex + 3).map((t) => t.id),
      ];
      const res = await djNext({
        currentMood: st.currentMood,
        recentMoods: st.recentMoods,
        mode: st.settings.flowMode,
        customTarget: st.settings.flowMode === "custom" ? st.settings.flowTarget : null,
        position: st.dj.position,
        horizon: st.settings.flowHorizon,
        currentTrack: current,
        excludeIds: exclude,
      });
      const after = usePlayerStore.getState();
      if (!res) {
        after.setDj({ deciding: false });
        return null;
      }
      after.setDj({
        deciding: false,
        pick: res.pick,
        alternates: res.alternates,
        reason: res.reason,
        target: res.target,
        poolSize: res.pool_size,
        exploring: res.exploring,
        policyWeight: res.policy_weight,
        library: res.library,
      });
      return res;
    },
    []
  );

  const queuePick = useCallback(
    (pick: DjPick, forTrack: string | null) => {
      const st = usePlayerStore.getState();
      if (st.dj.queuedForTrack === forTrack && forTrack !== null) return;
      send("queueadd", { tracks: [pick], next: true });
      st.setDj({ queuedForTrack: forTrack });
    },
    [send]
  );

  const onTrackStarted = useCallback(
    async (track: Track, previousId: string | null, previousStart: number, previousState: ListenerState | null) => {
      /* 1. The new track's mood, from the best source the library has. */
      const mood = await computeMood({
        id: track.id,
        title: track.title,
        artist: track.artist,
        genre: track.genre,
      }).catch(() => null);

      const st = usePlayerStore.getState();
      if (st.track?.id !== track.id) return; // moved on already

      if (mood) {
        usePlayerStore.setState((prev) => ({
          track: prev.track
            ? {
                ...prev.track,
                mood_vector: mood.mood_vector,
                mood_label: mood.mood_label,
                mood_source: mood.mood_source,
                mood_confidence: mood.mood_confidence,
              }
            : null,
        }));
        st.addRecentMood(mood.mood_vector);
        st.setCurrentMood(mood.mood_vector);
        st.setMoodReading({
          trackId: track.id,
          source: mood.mood_source,
          confidence: mood.mood_confidence,
          measured: mood.measured,
        });
      }

      const now = usePlayerStore.getState();
      const nextState: ListenerState = {
        currentMood: now.currentMood,
        recentMoods: now.recentMoods,
        targetMood: now.dj.target,
      };

      /* 2. How the previous track was received, now that we know what
            followed it. Adaptive Flow off stops new signals reaching the agent. */
      if (now.settings.adaptiveDj && previousId && previousId !== track.id && previousState) {
        const elapsed = Date.now() - previousStart;
        const prev = now.recentlyPlayed.find((t) => t.id === previousId);
        if (prev) {
          const totalMs = (prev.duration || 180) * 1000;
          submitFeedback({
            trackId: prev.id,
            moodVector: prev.mood_vector || [0.5, 0.5, 0.5, 0.5, 0.5],
            state: previousState,
            nextState,
            nextMoodVector: mood?.mood_vector ?? null,
            wasPlayedFully: elapsed > totalMs * 0.8,
            wasSkipped: elapsed < totalMs * 0.2,
            wasLiked: now.liked.has(prev.id),
            wasReplayed: false,
            playDurationMs: elapsed,
            totalDurationMs: totalMs,
          }).catch(() => {});
        }
      }
      stateAtStartRef.current = nextState;

      /* 3. A custom arc advances one step per track. */
      if (now.settings.flowMode === "custom") {
        now.setDj({ position: Math.min(now.settings.flowHorizon, now.dj.position + 1) });
      }

      /* 4. What comes next — and put it in the queue. */
      const res = await askDj(track);
      const latest = usePlayerStore.getState();
      if (res?.pick && latest.track?.id === track.id && latest.settings.autoQueue && latest.settings.adaptiveDj) {
        queuePick(res.pick, track.id);
      }
    },
    [askDj, queuePick]
  );

  /* ---- Engine events ---- */
  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (!e.data || typeof e.data.type !== "string" || !e.data.type.startsWith("af:")) return;
      const type = e.data.type.slice(3);
      const data = e.data;
      const s = usePlayerStore.getState();

      switch (type) {
        case "ready":
          /* null means the engine has not finished probing yet and will
             follow with `playbackconfig`; treating that as false would flash
             "playback not configured" on every launch. */
          usePlayerStore.setState({
            monoReady: true,
            ...(data.playbackConfigured === null
              ? {}
              : { playbackConfigured: Boolean(data.playbackConfigured) }),
          });
          /* Hand the engine a playback endpoint if one is configured. */
          if (PLAYBACK_API_BASE && PLAYBACK_API_TOKEN) {
            send("playbackconfig", { baseUrl: PLAYBACK_API_BASE, token: PLAYBACK_API_TOKEN });
          }
          send("getstate");
          /* The equaliser state carries the Sound Signature; the device list
             says what is playing the sound. */
          send("eqstate");
          send("devices", { requestLabels: false });
          break;

        /* The engine answers every transport and quality command with what it
           actually applied. Believing the answer rather than the request is
           what stops these controls drifting away from the sound. */
        case "shuffle":
          s.confirmFromEngine({ shuffle: Boolean(data.enabled) });
          break;

        case "repeat":
          s.confirmFromEngine({ repeat: String(data.mode) as RepeatMode });
          break;

        case "quality":
          s.confirmFromEngine({ streamQuality: String(data.tier) });
          break;

        case "spatial":
          s.confirmFromEngine({ spatial: Boolean(data.enabled) });
          break;

        case "atmos":
          s.confirmFromEngine({ atmos: Boolean(data.enabled) });
          break;

        case "downloadquality":
          s.confirmFromEngine({ downloadQuality: String(data.quality) });
          break;

        case "playbackopts":
          s.setPlaybackOpts({
            gapless: Boolean(data.gapless),
            crossfade: Boolean(data.crossfade),
            crossfadeSeconds: Number(data.crossfadeSeconds) || 5,
          });
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
          /* The 400 ms poll and loadedmetadata can both announce the same
             track; only the first arrival is a track change. */
          if (lastTrackRef.current === track.id) {
            usePlayerStore.setState({
              duration: data.duration || 0,
              streamInfo: (data.streamInfo as StreamInfo) ?? null,
            });
            break;
          }

          const previousId = lastTrackRef.current;
          const previousStart = playStartRef.current;
          /* The listener's state when the previous track started, captured
             then so the feedback describes that moment and not this one. */
          const previousState = stateAtStartRef.current;

          usePlayerStore.setState({
            track,
            duration: data.duration || 0,
            streamInfo: (data.streamInfo as StreamInfo) ?? null,
            moodReading: {
              trackId: track.id,
              source: track.mood_source ?? "unknown",
              confidence: track.mood_confidence ?? 0,
              seconds: 0,
              measured: null,
              live: false,
            },
          });
          s.resetWaveform();
          s.addToRecentlyPlayed(track);
          playStartRef.current = Date.now();
          lastTrackRef.current = track.id;

          /* Into the library, and counted as a play. */
          upsertLibrary([track], "play")
            .then(() => postLibraryEvent(track.id, "play"))
            .catch(() => {});

          void onTrackStarted(track, previousId, previousStart, previousState);
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
            upsertLibrary(results, "search").catch(() => {});
            scoreTracksAI(results, s.currentMood, s.recentMoods, s.dj.target)
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

        case "features": {
          /* What the engine has measured from the audio so far. Send it to
             the library, and let the reading it returns replace whatever
             the genre tag said. */
          const trackId = String(data.trackId ?? "");
          if (!trackId) break;
          const { final, type: _t, trackId: _id, ...features } = data as Record<string, unknown> & { final?: boolean };
          void _t;
          void _id;
          const seconds = Number(features.seconds) || 0;
          if (usePlayerStore.getState().track?.id === trackId) {
            s.setMoodReading({ trackId, seconds, live: !final });
          }
          postFeatures(trackId, seconds, features, Boolean(final))
            .then((res) => {
              if (!res || !res.stored) return;
              const st = usePlayerStore.getState();
              if (st.track?.id !== trackId) return;
              st.setMoodReading({
                trackId,
                source: res.mood_source,
                confidence: res.mood_confidence,
                seconds,
                measured: res.measured,
                live: !final,
              });
              if (res.mood_source === "measured") {
                usePlayerStore.setState((prev) => ({
                  track: prev.track
                    ? {
                        ...prev.track,
                        mood_vector: res.mood_vector,
                        mood_label: res.mood_label,
                        mood_source: res.mood_source,
                        mood_confidence: res.mood_confidence,
                      }
                    : null,
                  currentMood: res.mood_vector,
                }));
              }
            })
            .catch(() => {});
          break;
        }

        case "devices":
          usePlayerStore.getState().setDevices({
            supported: Boolean(data.supported),
            labelsAvailable: Boolean(data.labelsAvailable),
            current: String(data.current ?? ""),
            list: (data.devices || []) as PlayerState["devices"]["list"],
          });
          break;

        case "signature": {
          const { type: _type, ...rest } = data as Record<string, unknown>;
          void _type;
          usePlayerStore.getState().setSignature(rest as unknown as NonNullable<PlayerState["signature"]>);
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
          upsertLibrary((data.tracks || []) as Track[], "album").catch(() => {});
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
          upsertLibrary((data.tracks || []) as Track[], "artist").catch(() => {});
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

        case "eqstate": {
          const { signature, ...eq } = data as unknown as EqState & { signature?: PlayerState["signature"] };
          usePlayerStore.getState().setEq(eq as EqState);
          if (signature) usePlayerStore.getState().setSignature(signature);
          break;
        }

        case "importprogress": {
          /* The batched CSV path knows how many have matched; the one-pass
             parsers do not, and send null rather than a misleading zero. */
          const soFar = data.matched;
          usePlayerStore.getState().setImportState({
            running: true,
            current: Number(data.current) || 0,
            total: Number(data.total) || 0,
            item: String(data.item ?? ""),
            ...(typeof soFar === "number" ? { matchedCount: soFar } : {}),
          });
          break;
        }

        case "importdone": {
          const store = usePlayerStore.getState();
          if (data.error) {
            store.setImportState({ running: false, done: true, error: String(data.error) });
            break;
          }
          const matched = (data.tracks || []) as Track[];
          const playlists = (data.playlists || []) as { name: string; tracks: Track[] }[];
          upsertLibrary(matched, "import").catch(() => {});
          store.setImportState({
            running: false,
            done: true,
            error: null,
            matched,
            matchedCount: matched.length,
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
          /* Binaural rendering is the one setting the engine can refuse
             outright - not every platform has the DSP for it. Leaving the
             switch on would tell the listener it is doing something it is
             not, so put it back and say why. */
          if (data.scope === "spatial") s.confirmFromEngine({ spatial: false });
          break;
      }
    };

    window.addEventListener("message", handler);

    /* The engine announces itself once, when its player is up. If that
       happened before this listener existed — a fast boot, a shell reload —
       ask it to say so again, until it does. */
    const hello = setInterval(() => {
      if (usePlayerStore.getState().monoReady) return;
      send("hello");
    }, 1500);

    return () => {
      window.removeEventListener("message", handler);
      clearInterval(hello);
    };
  }, [send, onTrackStarted]);

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
      /** Gapless, crossfade and its length — all owned by the engine. */
      setPlaybackOpts: (o: { gapless?: boolean; crossfade?: boolean; crossfadeSeconds?: number }) =>
        send("playbackopts", o),
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
      /* The id travels with the index so the engine can tell whether the
         queue moved under us before the command landed. */
      queueRemove: (index: number, id?: string) => send("queueremove", { index, id }),
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
      /* ---- Output devices and the Sound Signature ---- */
      getDevices: (requestLabels = false) => send("devices", { requestLabels }),
      setDevice: (id: string) => send("setdevice", { id }),
      /** Switch layers, name the device, pick or forget a correction. */
      setSignature: (opts: {
        enabled?: boolean;
        loudness?: boolean;
        autoDevice?: boolean;
        deviceLabel?: string;
        headphone?: PlayerState["autoEq"]["headphones"][number];
        target?: string;
        clearDevice?: boolean;
      }) => send("signature", opts),
      /* ---- The DJ ---- */
      /** Ask the DJ again for what should follow the playing track. */
      djRefresh: async () => {
        const st = usePlayerStore.getState();
        const res = await askDj(st.track);
        const latest = usePlayerStore.getState();
        if (res?.pick && latest.settings.autoQueue && latest.settings.adaptiveDj) {
          queuePick(res.pick, latest.track?.id ?? null);
        }
      },
      /** Play the DJ's pick right now. */
      djPlayPick: () => {
        const st = usePlayerStore.getState();
        if (!st.dj.pick) return;
        send("play", { trackId: st.dj.pick.id, tracks: [st.dj.pick], searchQuery: "" });
      },
      /** Turn the pick down: a negative signal, then a fresh pick. */
      djReject: async () => {
        const st = usePlayerStore.getState();
        const pick = st.dj.pick;
        if (!pick) return;
        st.rejectPickLocally(pick.id);
        /* If it was already queued behind the current track, pull it. */
        const idx = st.queue.findIndex((t, i) => i > st.queueIndex && t.id === pick.id);
        if (idx >= 0) send("queueremove", { index: idx, id: pick.id });
        st.setDj({ pick: null, queuedForTrack: null, reason: "Choosing another…" });
        await djReject(pick.id, pick.mood_vector, {
          currentMood: st.currentMood,
          recentMoods: st.recentMoods,
          targetMood: st.dj.target,
        }).catch(() => {});
        const res = await askDj(usePlayerStore.getState().track);
        const latest = usePlayerStore.getState();
        if (res?.pick && latest.settings.autoQueue && latest.settings.adaptiveDj) {
          queuePick(res.pick, latest.track?.id ?? null);
        }
      },
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
          matchedCount: 0,
          missing: [],
          playlists: [],
          sourceName,
        });
        send("import", { text, format });
      },
    }),
    [send, askDj, queuePick]
  );
}
