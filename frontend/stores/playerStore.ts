import { create } from "zustand";

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
  trackNumber?: number;
  mood_vector?: number[];
  mood_label?: string;
  confidence?: number;
}

export type TabId = "home" | "search" | "library" | "queue";

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
  setTrack: (t: Track | null) => void;
  setPlaying: (p: boolean) => void;
  setLoading: (l: boolean) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setVolume: (v: number) => void;
  updatePlayback: (p: Partial<Pick<PlayerState, "playing" | "loading" | "currentTime" | "duration">>) => void;

  /* Queue */
  queue: Track[];
  queueIndex: number;
  setQueue: (q: Track[]) => void;
  setQueueIndex: (i: number) => void;

  /* Search */
  searchResults: Track[];
  searchQuery: string;
  searching: boolean;
  setSearchResults: (r: Track[]) => void;
  setSearchQuery: (q: string) => void;
  setSearching: (s: boolean) => void;

  /* Library */
  liked: Set<string>;
  toggleLike: (id: string) => void;
  isLiked: (id: string) => boolean;
  recentlyPlayed: Track[];
  addToRecentlyPlayed: (t: Track) => void;

  /* Now Playing expansion */
  isExpanded: boolean;
  setIsExpanded: (e: boolean) => void;

  /* AI */
  aiScores: Map<string, number>;
  setAiScores: (scores: Map<string, number>) => void;
  currentMood: number[];
  setCurrentMood: (m: number[]) => void;
  recentMoods: number[][];
  addRecentMood: (m: number[]) => void;

  /* Monochrome ready */
  monoReady: boolean;
  setMonoReady: (r: boolean) => void;
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

export const usePlayerStore = create<PlayerState>((set, get) => ({
  /* Navigation */
  activeTab: "home",
  setActiveTab: (tab) => set({ activeTab: tab }),

  /* Playback */
  track: null,
  playing: false,
  loading: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  setTrack: (t) => set({ track: t }),
  setPlaying: (p) => set({ playing: p }),
  setLoading: (l) => set({ loading: l }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setVolume: (v) => set({ volume: v }),
  updatePlayback: (p) => set(p),

  /* Queue */
  queue: [],
  queueIndex: 0,
  setQueue: (q) => set({ queue: q }),
  setQueueIndex: (i) => set({ queueIndex: i }),

  /* Search */
  searchResults: [],
  searchQuery: "lossless",
  searching: false,
  setSearchResults: (r) => set({ searchResults: r }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearching: (s) => set({ searching: s }),

  /* Library */
  liked: new Set<string>(),
  toggleLike: (id) =>
    set((s) => {
      const next = new Set(s.liked);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { liked: next };
    }),
  isLiked: (id) => get().liked.has(id),
  recentlyPlayed: [],
  addToRecentlyPlayed: (t) =>
    set((s) => {
      const filtered = s.recentlyPlayed.filter((x) => x.id !== t.id);
      return { recentlyPlayed: [t, ...filtered].slice(0, 50) };
    }),

  /* Now Playing */
  isExpanded: false,
  setIsExpanded: (e) => set({ isExpanded: e }),

  /* AI */
  aiScores: new Map(),
  setAiScores: (scores) => set({ aiScores: scores }),
  currentMood: [0.5, 0.5, 0.5, 0.5, 0.5],
  setCurrentMood: (m) => set({ currentMood: m }),
  recentMoods: [],
  addRecentMood: (m) =>
    set((s) => ({ recentMoods: [...s.recentMoods.slice(-9), m] })),

  /* Monochrome */
  monoReady: false,
  setMonoReady: (r) => set({ monoReady: r }),
}));
