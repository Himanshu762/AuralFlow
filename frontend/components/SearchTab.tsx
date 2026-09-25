"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search as SearchIcon, X, Play, AudioLines, Clock, Disc3 } from "lucide-react";
import { usePlayerStore, type Track } from "../stores/playerStore";
import { qualityBadge } from "../lib/format";
import TrackRow, { TrackRowHeader } from "./TrackRow";
import SectionHeading from "./SectionHeading";
import ExploreMosaic from "./ExploreMosaic";

interface Props {
  onSearch: (query: string) => void;
  onPlay: (track: Track) => void;
  /** Focused by ⌘K / Ctrl+F from the shell. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  compact: boolean;
}

export default function SearchTab({ onSearch, onPlay, inputRef, compact }: Props) {
  const searchResults = usePlayerStore((s) => s.searchResults);
  const searching = usePlayerStore((s) => s.searching);
  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const aiScores = usePlayerStore((s) => s.aiScores);
  const recentSearches = usePlayerStore((s) => s.recentSearches);
  const addRecentSearch = usePlayerStore((s) => s.addRecentSearch);
  const clearRecentSearches = usePlayerStore((s) => s.clearRecentSearches);
  const openAlbum = usePlayerStore((s) => s.openAlbum);

  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [focused, setFocused] = useState(false);
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length > 1) {
      debounceRef.current = setTimeout(() => onSearch(val.trim()), 400);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = localQuery.trim();
    if (!q) return;
    onSearch(q);
    addRecentSearch(q);
  };

  const runQuery = (q: string) => {
    setLocalQuery(q);
    onSearch(q);
    addRecentSearch(q);
  };

  const clear = () => {
    setLocalQuery("");
    ref.current?.focus();
  };

  const ranked = [...searchResults].sort(
    (a, b) => (aiScores.get(b.id) ?? 0) - (aiScores.get(a.id) ?? 0)
  );
  const topResult = ranked[0] ?? null;
  const trackResults = searchResults.filter((t) => t.id !== topResult?.id);
  const topBadge = topResult ? qualityBadge(topResult) : null;

  return (
    <div className="flex flex-col gap-8 max-w-[1500px]">
      {/* ================= Search field ================= */}
      <div className="flex flex-col items-center gap-4">
        <form onSubmit={handleSubmit} className="w-full max-w-2xl">
          <div
            className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl transition-all duration-200 ${
              focused
                ? "bg-surface-high ring-2 ring-primary-container/60"
                : "bg-surface-container ring-1 ring-white/10"
            }`}
          >
            <SearchIcon className={`w-5 h-5 flex-shrink-0 ${focused ? "text-on-surface" : "text-outline"}`} />
            <input
              ref={ref}
              type="text"
              placeholder="Search artists, albums, frequencies…"
              value={localQuery}
              onChange={handleChange}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className="flex-1 bg-transparent outline-none text-on-surface placeholder-outline text-body-lg"
            />
            {localQuery && (
              <button type="button" onClick={clear} aria-label="Clear search" className="p-1 text-outline hover:text-on-surface">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>

        {searching && (
          <div className="flex items-center gap-2 text-[12px] text-outline">
            <span className="w-3 h-3 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
            Searching the catalogue…
          </div>
        )}
      </div>

      {/* ================= Results: top result + track list ================= */}
      {searchResults.length > 0 ? (
        <div className={`grid gap-6 items-start ${compact ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-[minmax(320px,420px)_1fr] xl:gap-7"}`}>
          {/* --- Top result --- */}
          <AnimatePresence mode="wait">
            {topResult && (
              <motion.section
                key={topResult.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <h3 className="text-label-md uppercase tracking-wider text-outline font-bold mb-3 flex items-center gap-1.5">
                  Top Result
                  <AudioLines className="w-3.5 h-3.5 text-primary" />
                </h3>
                <button
                  type="button"
                  onClick={() => onPlay(topResult)}
                  className="relative w-full overflow-hidden rounded-xl group ring-1 ring-white/10 shadow-xl text-left"
                >
                  <div className="aspect-[4/3] w-full">
                    <img
                      src={topResult.coverLarge || topResult.cover}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5">
                    <div className="flex items-center gap-1.5 mb-2">
                      {topBadge && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${topBadge.cls}`}>
                          {topBadge.longLabel}
                        </span>
                      )}
                      {aiScores.get(topResult.id) !== undefined && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary-container/15 text-primary ring-1 ring-primary-container/40">
                          AI {Math.round((aiScores.get(topResult.id) ?? 0) * 100)}%
                        </span>
                      )}
                    </div>
                    <h4 className="text-headline-md text-white line-clamp-2">{topResult.title}</h4>
                    <p className="text-[13px] text-white/60 mt-1">{topResult.artist}</p>
                  </div>
                  <span className="absolute bottom-5 right-5 w-12 h-12 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all">
                    <Play className="w-6 h-6 fill-current ml-0.5" />
                  </span>
                </button>

                {/* Route into the album screen */}
                <button
                  type="button"
                  onClick={() => openAlbum(topResult)}
                  className="mt-2.5 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container hover:bg-surface-high text-on-surface-variant hover:text-on-surface text-[13px] font-medium transition-colors"
                >
                  <Disc3 className="w-4 h-4" />
                  View album
                </button>
              </motion.section>
            )}
          </AnimatePresence>

          {/* --- Track list --- */}
          <section className="min-w-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-label-md uppercase tracking-wider text-outline font-bold">Tracks</h3>
              <span className="text-[11px] text-outline">{trackResults.length} results</span>
            </div>

            <div className="@container rounded-xl bg-surface-low p-2 flex flex-col gap-0.5">
              <TrackRowHeader />
              {trackResults.map((t, i) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  index={i}
                  onPlay={onPlay}
                  score={aiScores.get(t.id)}
                  touch={compact}
                />
              ))}
            </div>
          </section>
        </div>
      ) : (
        !searching && (
          <div className="flex flex-col gap-9">
            {/* Recent — from search_vision_v2, backed by real history */}
            {recentSearches.length > 0 && (
              <section>
                <SectionHeading
                  title="Recent"
                  onSeeAll={clearRecentSearches}
                  seeAllLabel="Clear"
                />
                <div className="flex flex-wrap gap-2">
                  {recentSearches.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => runQuery(q)}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-surface-container hover:bg-surface-high text-on-surface-variant hover:text-on-surface text-[13px] font-medium transition-colors"
                    >
                      <Clock className="w-3.5 h-3.5 text-outline" />
                      {q}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <SectionHeading title="Explore" subtitle="Browse the catalogue by sound" />
              <ExploreMosaic onSelect={runQuery} columns={compact ? 2 : 3} />
            </section>
          </div>
        )
      )}
    </div>
  );
}
