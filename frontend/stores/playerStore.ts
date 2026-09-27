import { create } from "zustand";
import {
  postLibraryEvent,
  type DjPick,
  type FlowMode,
  type LibraryStats,
  type MeasuredSummary,
  type MoodSource,
} from "../lib/api";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumId?: string;
  duration?: number;
  cover?: string;
  coverLarge?: string;
  audioQuality?: string;
  audioModes?: string[];
  genre?: string;
  artistId?: string | null;
  /** Set on downloaded tracks: path relative to the music folder. */
  path?: string;
  /** Size in bytes, for downloaded tracks. */
  size?: number;
  trackNumber?: number;
  mood_vector?: number[];
  mood_label?: string;
  mood_source?: MoodSource;
  mood_confidence?: number;
  confidence?: number;
}

/** Where the current mood reading came from, and how much audio it rests on. */
export interface MoodReading {
  trackId: string | null;
  source: MoodSource;
  confidence: number;
  /** Seconds of audio the engine has analysed for this track so far. */
  seconds: number;
  measured: MeasuredSummary | null;
  /** True while the engine is still measuring the playing track. */
  live: boolean;
}

/** The DJ: the arc, and what it has chosen to play next. */
export interface DjState {
  pick: DjPick | null;
  alternates: DjPick[];
  reason: string;
  target: number[] | null;
  poolSize: number;
  exploring: boolean;
  policyWeight: number;
  deciding: boolean;
  /** Track id the current pick was queued behind, so it is never queued twice. */
  queuedForTrack: string | null;
  /** Position along a custom arc, in tracks. */
  position: number;
  library: LibraryStats | null;
  rejected: string[];
}

export interface OutputDevice {
  id: string;
  label: string;
  kind: "headphones" | "speakers" | "unknown";
  current: boolean;
}

export interface DevicesState {
  supported: boolean;
  labelsAvailable: boolean;
  current: string;
  list: OutputDevice[];
}

/** The engine's Sound Signature: the layers that make up the running EQ. */
export interface SignatureState {
  enabled: boolean;
  loudnessOn: boolean;
  autoDevice: boolean;
  device: {
    id: string;
    label: string;
    kind: "headphones" | "speakers" | "unknown";
    correction: number[] | null;
    headphone: { name: string; type: string; path: string; fileName: string } | null;
    target: string | null;
    source: "none" | "auto" | "manual" | "profile";
    message: string | null;
  };
  track: number[] | null;
  loudness: number[] | null;
  manual: number[];
  composed: number[] | null;
  frequencies: number[];
  volume: number;
}

export type TabId = "home" | "search" | "library" | "queue" | "settings";

export type RepeatMode = "off" | "all" | "one";

/**
 * Facts about the stream the engine actually resolved. Null until playback
 * starts — nothing here is inferred from the track metadata.
 */
export interface StreamInfo {
  codec: string | null;
  quality: string | null;
  bitDepth: number | null;
  sampleRate: number | null;
  provider: string | null;
  mimeType: string | null;
}

/**
 * A detail screen pushed over the current tab.
 *
 * Albums and artists are identified by name rather than id: the catalogue
 * gives us tracks, and we group them, so the name is the only stable key.
 */
export type DetailView =
  | { kind: "album"; album: string; artist: string; cover?: string; id?: string | null }
  | { kind: "artist"; artist: string; cover?: string; id?: string | null };

/** A record fetched from the catalogue, rather than filtered out of a search. */
export interface AlbumDetail {
  id: string;
  title: string;
  artist: string;
  cover: string;
  year: number | null;
  tracks: Track[];
  error?: string;
}

export interface ArtistDetail {
  id: string;
  name: string;
  cover: string;
  tracks: Track[];
  albums: { id: string; title: string; cover: string; year: number | null }[];
  error?: string;
}

/** Right-hand inspector tabs, from the Stitch desktop workstation sidecar. */
export type RailTab = "engine" | "queue" | "lyrics";

export interface AiStats {
  explorationRate: number;
  memorySize: number;
  trainingSteps: number;
  lastReward: number | null;
  online: boolean;
}

export interface AudioSettings {
  /** Preferred stream tier — mirrors the Stitch "Audio Quality" settings screen. */
  streamQuality: "hi-res" | "lossless" | "high";
  dolbyAtmos: boolean;
  headTracking: boolean;
  /** Feed the mood engine with every play, not just likes. */
  adaptiveDj: boolean;
  /** Render the WebGL shader backdrop. */
  shaderBackground: boolean;
  /** The session arc the DJ steers by. */
  flowMode: FlowMode;
  /** Target for the custom arc. */
  flowTarget: number[];
  /** How many tracks a custom arc takes to arrive. */
  flowHorizon: number;
  /** Let the DJ queue its pick behind the playing track automatically. */
  autoQueue: boolean;
}

/**
 * What the engine has confirmed it actually applied.
 *
 * Transport modes, stream quality and spatial rendering live in the engine,
 * not here. The shell asks for a value and the engine answers with the value
 * it really set - which is not always the one asked for: an unknown quality
 * tier falls back, and binaural rendering can refuse outright. Keeping the
 * answer lets the controls show the truth instead of the request, and lets
 * the mirroring effects tell "not asked yet" apart from "asked and answered",
 * so they do not ask again in a loop.
 */
export interface EngineConfirmed {
  shuffle: boolean | null;
  repeat: RepeatMode | null;
  streamQuality: string | null;
  spatial: boolean | null;
  atmos: boolean | null;
  downloadQuality: string | null;
}

export interface PlayerState {
  /* Navigation */
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;

  /* Playback */
  track: Track | null;
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  setTrack: (t: Track | null) => void;
  setPlaying: (p: boolean) => void;
  setLoading: (l: boolean) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  updatePlayback: (p: Partial<Pick<PlayerState, "playing" | "loading" | "currentTime" | "duration">>) => void;

  /* Search */
  searchResults: Track[];
  searchQuery: string;
  searching: boolean;
  recentSearches: string[];
  setSearchResults: (r: Track[]) => void;
  setSearchQuery: (q: string) => void;
  setSearching: (s: boolean) => void;
  addRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;

  /* Library */
  liked: Set<string>;
  toggleLike: (id: string) => void;
  isLiked: (id: string) => boolean;
  recentlyPlayed: Track[];
  addToRecentlyPlayed: (t: Track) => void;
  clearHistory: () => void;

  /* Now Playing expansion */
  isExpanded: boolean;
  setIsExpanded: (e: boolean) => void;

  /* Live engine telemetry */
  streamInfo: StreamInfo | null;
  setStreamInfo: (s: StreamInfo | null) => void;
  /** Ten normalised FFT band levels (0..1) from the engine's analyser. */
  spectrum: number[];
  setSpectrum: (levels: number[]) => void;
  /**
   * Amplitude envelope of the current track, filled in as it plays.
   * -1 means "not heard yet"; anything else is a real measured RMS.
   */
  waveform: number[];
  recordWaveform: (position: number, duration: number, rms: number) => void;
  resetWaveform: () => void;

  /* Detail screens (album / artist), pushed over the active tab */
  detail: DetailView | null;
  openAlbum: (t: Track) => void;
  openArtist: (t: Track) => void;
  closeDetail: () => void;
  /** Catalogue data for the open detail screen, once the engine returns it. */
  albumDetail: AlbumDetail | null;
  artistDetail: ArtistDetail | null;
  setAlbumDetail: (a: AlbumDetail | null) => void;
  setArtistDetail: (a: ArtistDetail | null) => void;

  /* Desktop chrome */
  railOpen: boolean;
  setRailOpen: (o: boolean) => void;
  toggleRail: () => void;
  railTab: RailTab;
  setRailTab: (t: RailTab) => void;

  /* AI */
  aiScores: Map<string, number>;
  /** Candidate ids in the agent's ranking order, best first. */
  aiRanking: string[];
  setAiScores: (scores: Map<string, number>) => void;
  currentMood: number[];
  setCurrentMood: (m: number[]) => void;
  recentMoods: number[][];
  addRecentMood: (m: number[]) => void;
  aiStats: AiStats;
  setAiStats: (s: Partial<AiStats>) => void;
  /** Provenance of the mood reading for the playing track. */
  moodReading: MoodReading;
  setMoodReading: (r: Partial<MoodReading>) => void;

  /* The DJ */
  dj: DjState;
  setDj: (patch: Partial<DjState>) => void;
  rejectPickLocally: (id: string) => void;

  /* Output devices and the Sound Signature, both owned by the engine */
  devices: DevicesState;
  setDevices: (d: DevicesState) => void;
  signature: SignatureState | null;
  setSignature: (s: SignatureState | null) => void;

  /* Settings */
  settings: AudioSettings;
  /** The values the engine has confirmed; null until it has answered. */
  engineConfirmed: EngineConfirmed;
  /** How one track gives way to the next, as the engine has it. */
  playbackOpts: { gapless: boolean; crossfade: boolean; crossfadeSeconds: number };
  setPlaybackOpts: (o: Partial<PlayerState["playbackOpts"]>) => void;
  /** Minutes until playback stops, or null when no timer is running. */
  sleepTimer: { endsAt: number; minutes: number } | null;
  setSleepTimer: (minutes: number | null) => void;
  /** Record an engine confirmation and show it. */
  confirmFromEngine: (patch: Partial<EngineConfirmed>) => void;
  setSetting: <K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => void;

  /* Storage hydration — see hydrate() */
  hydrated: boolean;
  hydrate: () => void;

  /* Monochrome ready */
  monoReady: boolean;
  setMonoReady: (r: boolean) => void;
  /** True once the engine has a playback endpoint it can actually stream from. */
  playbackConfigured: boolean;
  setPlaybackConfigured: (c: boolean) => void;

  /* Playlists — created here or brought in from another service */
  playlists: Playlist[];
  createPlaylist: (name: string, tracks?: Track[], source?: string) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, tracks: Track[]) => void;
  removeFromPlaylist: (id: string, trackId: string) => void;

  /* Equaliser */
  eq: EqState;
  setEq: (eq: EqState) => void;
  /** Preset curves the engine offers, fetched on demand. */
  eqPresets: { id: string; name: string; gains: number[] }[];
  setEqPresets: (p: PlayerState["eqPresets"]) => void;
  /** Headphone corrections: what can be applied, and what is applied. */
  autoEq: {
    headphones: { name: string; type: string; path: string; fileName: string }[];
    targets: { id: string; label: string }[];
    applied: string | null;
    message: string | null;
    searching: boolean;
  };
  setAutoEq: (patch: Partial<PlayerState["autoEq"]>) => void;

  /* Downloaded files, served by the native shell from the music folder. */
  offline: { tracks: Track[]; error: string | null; loaded: boolean };
  setOffline: (o: PlayerState["offline"]) => void;

  /**
   * Set when the engine says it is playing but the position never moves.
   *
   * On Linux the webview decodes through GStreamer, and without the right
   * plugins installed it reports playback while producing no audio and no
   * error. That looked exactly like the app hanging, so name it instead.
   */
  stalled: string | null;
  setStalled: (reason: string | null) => void;

  /* Catalogue and streaming backends the engine talks to. */
  instances: {
    discovered: { api: { url: string; version?: string }[]; streaming: { url: string; version?: string }[] };
    user: { api: { url: string }[]; streaming: { url: string }[] };
  } | null;
  setInstances: (i: PlayerState["instances"]) => void;

  /* Saving tracks to disk. */
  download: { state: "idle" | "started" | "done" | "error"; count: number; title: string; message: string };
  setDownload: (d: PlayerState["download"]) => void;

  /* Lyrics for the current track, when the catalogue has any. */
  lyrics: { trackId: string | null; lines: { time: number; text: string }[]; plain: string; synced: boolean };
  setLyrics: (l: PlayerState["lyrics"]) => void;

  /* The engine's play queue — the same list playback actually works from. */
  queue: Track[];
  queueIndex: number;
  setQueue: (tracks: Track[], index: number) => void;

  /* Library import */
  importState: ImportState;
  setImportState: (s: Partial<ImportState>) => void;
  resetImport: () => void;
}

/** The engine's equaliser, plus the adaptive layer that drives it. */
export interface EqState {
  enabled: boolean;
  /** One gain in dB per band. */
  gains: number[];
  /** Band centre frequencies in Hz, same length as `gains`. */
  frequencies: number[];
  preamp: number;
  adaptive: {
    on: boolean;
    /** dB per decade: negative is warmer, positive brighter. */
    tilt: number;
    /** 0..1 — how much of the measured correction is applied. */
    strength: number;
    /** What the stabiliser is applying right now, or null when it is off. */
    curve: number[] | null;
  };
}

/** A saved list of tracks. `source` records where it came from. */
export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: number;
  /** "auralflow" for one made here, otherwise the file it was imported from. */
  source: string;
}

/** Progress and results of bringing a library across from another service. */
export interface ImportState {
  running: boolean;
  /** The file this run came from, used to name a list the file did not name. */
  sourceName: string;
  /** Rows resolved so far, and how many there are in total. */
  current: number;
  total: number;
  /** The row being looked up right now. */
  item: string;
  /** Tracks that were found in the catalogue. Filled in when the run ends. */
  matched: Track[];
  /** How many have matched so far, which is knowable while the run is going. */
  matchedCount: number;
  /** Rows that could not be matched, so the user knows what did not come across. */
  missing: { title: string; artist: string; type: string }[];
  /** Playlists the file described, once the run finishes. */
  playlists: { name: string; tracks: Track[] }[];
  error: string | null;
  /** True once a run has finished, so the UI can show the summary. */
  done: boolean;
}

const EMPTY_IMPORT: ImportState = {
  running: false,
  sourceName: "",
  current: 0,
  total: 0,
  item: "",
  matched: [],
  matchedCount: 0,
  missing: [],
  playlists: [],
  error: null,
  done: false,
};

/* ------------------------------------------------------------------ */
/* Persistence — settings + liked survive restarts                    */
/* ------------------------------------------------------------------ */

/** Resolution of the measured amplitude envelope. */
export const WAVEFORM_BUCKETS = 48;

const SETTINGS_KEY = "auralflow:settings";
const LIKED_KEY = "auralflow:liked";
const RECENT_SEARCH_KEY = "auralflow:recent-searches";
const HISTORY_KEY = "auralflow:recently-played";
const PLAYLISTS_KEY = "auralflow:playlists";

/** How many played tracks are kept, in memory and on disk. */
const HISTORY_LIMIT = 50;

const DEFAULT_SETTINGS: AudioSettings = {
  streamQuality: "hi-res",
  dolbyAtmos: true,
  headTracking: false,
  adaptiveDj: true,
  shaderBackground: true,
  flowMode: "drift",
  flowTarget: [0.5, 0.5, 0.5, 0.5, 0.5],
  flowHorizon: 6,
  autoQueue: true,
};

const EMPTY_DJ: DjState = {
  pick: null,
  alternates: [],
  reason: "",
  target: null,
  poolSize: 0,
  exploring: false,
  policyWeight: 0,
  deciding: false,
  queuedForTrack: null,
  position: 0,
  library: null,
  rejected: [],
};

const EMPTY_READING: MoodReading = {
  trackId: null,
  source: "unknown",
  confidence: 0,
  seconds: 0,
  measured: null,
  live: false,
};

function loadSettings(): AudioSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(s: AudioSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — settings stay in-memory for this session */
  }
}

function loadLiked(): Set<string> {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(LIKED_KEY);
    return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function loadRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCH_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((q) => typeof q === "string") : [];
  } catch {
    return [];
  }
}

function persistRecentSearches(queries: string[]) {
  try {
    window.localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(queries));
  } catch {
    /* storage unavailable */
  }
}

function loadRecentlyPlayed(): Track[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Track[]).filter((t) => t && t.id) : [];
  } catch {
    return [];
  }
}

function persistRecentlyPlayed(tracks: Track[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(tracks));
  } catch {
    /* storage unavailable or full — history stays in-memory this session */
  }
}

function loadPlaylists(): Playlist[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PLAYLISTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as Playlist[]).filter(
      (p) => p && typeof p.id === "string" && Array.isArray(p.tracks)
    );
  } catch {
    return [];
  }
}

function persistPlaylists(playlists: Playlist[]) {
  try {
    window.localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  } catch {
    /* storage unavailable or full — playlists stay in-memory this session */
  }
}

function persistLiked(liked: Set<string>) {
  try {
    window.localStorage.setItem(LIKED_KEY, JSON.stringify(Array.from(liked)));
  } catch {
    /* storage unavailable */
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/*                                                                    */
/* The store is created with the same defaults on the server and in   */
/* the browser; stored values are pulled in by hydrate() after mount, */
/* so the first client render still matches the server HTML.          */
/* ------------------------------------------------------------------ */

export const usePlayerStore = create<PlayerState>((set, get) => ({
  /* Navigation */
  activeTab: "home",
  setActiveTab: (tab) => set({ activeTab: tab, detail: null }),

  /* Playback */
  track: null,
  playing: false,
  loading: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: "off",
  setTrack: (t) => set({ track: t }),
  setPlaying: (p) => set({ playing: p }),
  setLoading: (l) => set({ loading: l }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setVolume: (v) => set({ volume: v }),
  setMuted: (m) => set({ muted: m }),
  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  cycleRepeat: () =>
    set((s) => ({ repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off" })),
  updatePlayback: (p) => set(p),

  /* Search */
  searchResults: [],
  searchQuery: "",
  searching: false,
  recentSearches: [],
  setSearchResults: (r) => set({ searchResults: r }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearching: (s) => set({ searching: s }),
  addRecentSearch: (q) =>
    set((s) => {
      const query = q.trim();
      if (!query) return {};
      const next = [query, ...s.recentSearches.filter((r) => r !== query)].slice(0, 8);
      persistRecentSearches(next);
      return { recentSearches: next };
    }),
  clearRecentSearches: () => {
    persistRecentSearches([]);
    return set({ recentSearches: [] });
  },

  /* Library */
  liked: new Set<string>(),
  toggleLike: (id) =>
    set((s) => {
      const next = new Set(s.liked);
      const liked = !next.has(id);
      if (liked) next.add(id);
      else next.delete(id);
      persistLiked(next);
      /* The library keeps likes too: they weight the DJ's ranking. */
      postLibraryEvent(id, liked ? "like" : "unlike").catch(() => {});
      return { liked: next };
    }),
  isLiked: (id) => get().liked.has(id),
  recentlyPlayed: [],
  addToRecentlyPlayed: (t) =>
    set((s) => {
      const filtered = s.recentlyPlayed.filter((x) => x.id !== t.id);
      const recentlyPlayed = [t, ...filtered].slice(0, HISTORY_LIMIT);
      persistRecentlyPlayed(recentlyPlayed);
      return { recentlyPlayed };
    }),
  clearHistory: () => {
    persistRecentlyPlayed([]);
    return set({ recentlyPlayed: [] });
  },

  /* Now Playing */
  isExpanded: false,
  setIsExpanded: (e) => set({ isExpanded: e }),

  /* Live engine telemetry */
  streamInfo: null,
  setStreamInfo: (info) => set({ streamInfo: info }),
  spectrum: new Array(10).fill(0),
  setSpectrum: (levels) => set({ spectrum: levels }),
  waveform: new Array(WAVEFORM_BUCKETS).fill(-1),
  recordWaveform: (position, duration, rms) =>
    set((s) => {
      if (!duration || duration <= 0) return {};
      const bucket = Math.min(
        WAVEFORM_BUCKETS - 1,
        Math.max(0, Math.floor((position / duration) * WAVEFORM_BUCKETS))
      );
      if (s.waveform[bucket] >= rms) return {}; // keep the loudest reading
      const next = [...s.waveform];
      next[bucket] = rms;
      return { waveform: next };
    }),
  resetWaveform: () => set({ waveform: new Array(WAVEFORM_BUCKETS).fill(-1) }),

  /* Detail screens */
  detail: null,
  openAlbum: (t) =>
    set({
      /* Clear the previous record so its tracks never show under the new
         title while the fetch is still in flight. */
      albumDetail: null,
      detail: {
        kind: "album",
        album: t.album || t.title,
        artist: t.artist,
        cover: t.coverLarge || t.cover,
        id: t.albumId ?? null,
      },
    }),
  openArtist: (t) =>
    set({
      artistDetail: null,
      detail: {
        kind: "artist",
        artist: t.artist,
        cover: t.coverLarge || t.cover,
        id: t.artistId ?? null,
      },
    }),
  closeDetail: () => set({ detail: null, albumDetail: null, artistDetail: null }),
  albumDetail: null,
  artistDetail: null,
  setAlbumDetail: (albumDetail) => set({ albumDetail }),
  setArtistDetail: (artistDetail) => set({ artistDetail }),

  /* Desktop chrome */
  railOpen: true,
  setRailOpen: (o) => set({ railOpen: o }),
  toggleRail: () => set((s) => ({ railOpen: !s.railOpen })),
  railTab: "engine",
  setRailTab: (t) => set({ railTab: t }),

  /* AI */
  aiScores: new Map(),
  aiRanking: [],
  setAiScores: (scores) => set({ aiScores: scores }),
  currentMood: [0.5, 0.5, 0.5, 0.5, 0.5],
  setCurrentMood: (m) => set({ currentMood: m }),
  recentMoods: [],
  addRecentMood: (m) =>
    set((s) => ({ recentMoods: [...s.recentMoods.slice(-9), m] })),
  aiStats: {
    explorationRate: 0.3,
    memorySize: 0,
    trainingSteps: 0,
    lastReward: null,
    online: false,
  },
  setAiStats: (s) => set((prev) => ({ aiStats: { ...prev.aiStats, ...s } })),
  moodReading: EMPTY_READING,
  setMoodReading: (r) => set((prev) => ({ moodReading: { ...prev.moodReading, ...r } })),

  dj: EMPTY_DJ,
  setDj: (patch) => set((prev) => ({ dj: { ...prev.dj, ...patch } })),
  rejectPickLocally: (id) =>
    set((prev) => ({ dj: { ...prev.dj, rejected: [...prev.dj.rejected, id].slice(-40) } })),

  devices: { supported: false, labelsAvailable: false, current: "", list: [] },
  setDevices: (devices) => set({ devices }),
  signature: null,
  setSignature: (signature) => set({ signature }),

  /* Settings */
  settings: DEFAULT_SETTINGS,
  playbackOpts: { gapless: true, crossfade: false, crossfadeSeconds: 5 },
  setPlaybackOpts: (o) => set((st) => ({ playbackOpts: { ...st.playbackOpts, ...o } })),
  sleepTimer: null,
  setSleepTimer: (minutes) =>
    set({
      sleepTimer:
        minutes && minutes > 0 ? { endsAt: Date.now() + minutes * 60_000, minutes } : null,
    }),
  engineConfirmed: {
    shuffle: null,
    repeat: null,
    streamQuality: null,
    spatial: null,
    atmos: null,
    downloadQuality: null,
  },
  confirmFromEngine: (patch) =>
    set((state) => {
      const settings = { ...state.settings };
      if (patch.streamQuality === "hi-res" || patch.streamQuality === "lossless" || patch.streamQuality === "high") {
        settings.streamQuality = patch.streamQuality;
      }
      if (typeof patch.spatial === "boolean") settings.headTracking = patch.spatial;
      if (typeof patch.atmos === "boolean") settings.dolbyAtmos = patch.atmos;
      /* Keep what the engine settled on, so the next launch asks for the
         value that actually worked rather than the one that was refused. */
      if (settings !== state.settings) persistSettings(settings);
      return {
        engineConfirmed: { ...state.engineConfirmed, ...patch },
        settings,
        ...(typeof patch.shuffle === "boolean" ? { shuffle: patch.shuffle } : {}),
        ...(patch.repeat ? { repeat: patch.repeat } : {}),
      };
    }),
  setSetting: (key, value) =>
    set((s) => {
      const next = { ...s.settings, [key]: value };
      persistSettings(next);
      return { settings: next };
    }),

  /* Storage hydration — called once from the shell after mount. */
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({
      hydrated: true,
      liked: loadLiked(),
      settings: loadSettings(),
      recentSearches: loadRecentSearches(),
      recentlyPlayed: loadRecentlyPlayed(),
      playlists: loadPlaylists(),
    });
  },

  /* Monochrome */
  monoReady: false,
  setMonoReady: (r) => set({ monoReady: r }),
  playbackConfigured: false,
  setPlaybackConfigured: (c) => set({ playbackConfigured: c }),

  /* ---------------- Playlists ---------------- */

  playlists: [],

  createPlaylist: (name, tracks = [], source = "auralflow") => {
    const id = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    set((state) => {
      const next = [
        { id, name, tracks, createdAt: Date.now(), source },
        ...state.playlists,
      ];
      persistPlaylists(next);
      return { playlists: next };
    });
    return id;
  },

  renamePlaylist: (id, name) =>
    set((state) => {
      const next = state.playlists.map((p) => (p.id === id ? { ...p, name } : p));
      persistPlaylists(next);
      return { playlists: next };
    }),

  deletePlaylist: (id) =>
    set((state) => {
      const next = state.playlists.filter((p) => p.id !== id);
      persistPlaylists(next);
      return { playlists: next };
    }),

  addToPlaylist: (id, tracks) =>
    set((state) => {
      const next = state.playlists.map((p) => {
        if (p.id !== id) return p;
        /* Adding a track already in the list should not duplicate it. */
        const seen = new Set(p.tracks.map((t) => t.id));
        return { ...p, tracks: [...p.tracks, ...tracks.filter((t) => !seen.has(t.id))] };
      });
      persistPlaylists(next);
      return { playlists: next };
    }),

  removeFromPlaylist: (id, trackId) =>
    set((state) => {
      const next = state.playlists.map((p) =>
        p.id === id ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) } : p
      );
      persistPlaylists(next);
      return { playlists: next };
    }),

  /* ---------------- Equaliser ---------------- */

  eq: {
    enabled: false,
    gains: [],
    frequencies: [],
    preamp: 0,
    adaptive: { on: false, tilt: 0, strength: 0.7, curve: null },
  },
  setEq: (eq) => set({ eq }),
  eqPresets: [],
  setEqPresets: (eqPresets) => set({ eqPresets }),
  autoEq: { headphones: [], targets: [], applied: null, message: null, searching: false },
  setAutoEq: (patch) => set((state) => ({ autoEq: { ...state.autoEq, ...patch } })),

  offline: { tracks: [], error: null, loaded: false },
  setOffline: (offline) => set({ offline }),

  stalled: null,
  setStalled: (stalled) => set({ stalled }),

  instances: null,
  setInstances: (instances) => set({ instances }),

  download: { state: "idle", count: 0, title: "", message: "" },
  setDownload: (download) => set({ download }),

  lyrics: { trackId: null, lines: [], plain: "", synced: false },
  setLyrics: (lyrics) => set({ lyrics }),

  queue: [],
  queueIndex: -1,
  setQueue: (queue, queueIndex) => set({ queue, queueIndex }),

  /* ---------------- Library import ---------------- */

  importState: EMPTY_IMPORT,
  setImportState: (patch) => set((state) => ({ importState: { ...state.importState, ...patch } })),
  resetImport: () => set({ importState: EMPTY_IMPORT }),
}));
