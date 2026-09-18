"use client";

import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search as SearchIcon, X, Play, AudioLines } from "lucide-react";
import { usePlayerStore, type Track } from "../stores/playerStore";

function qualityBadge(track: Track) {
  if (track.audioQuality === "HI_RES_LOSSLESS")
    return { label: "Hi-Res", cls: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
  if (track.audioQuality === "LOSSLESS")
    return { label: "Lossless", cls: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
  if (track.audioModes?.includes("DOLBY_ATMOS"))
    return { label: "Atmos", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  return null;
}

function fmtDuration(s?: number) {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

interface Props {
  onSearch: (query: string) => void;
  onPlay: (track: Track) => void;
}

export default function SearchTab({ onSearch, onPlay }: Props) {
  const searchResults = usePlayerStore((s) => s.searchResults);
  const searching = usePlayerStore((s) => s.searching);
  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const aiScores = usePlayerStore((s) => s.aiScores);

  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

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
    if (localQuery.trim()) onSearch(localQuery.trim());
  };

  const clear = () => {
    setLocalQuery("");
    inputRef.current?.focus();
  };

  const topResult = searchResults.length > 0
    ? [...searchResults].sort((a, b) => (aiScores.get(b.id) || 0) - (aiScores.get(a.id) || 0))[0]
    : null;

  const trackResults = searchResults.filter((t) => t.id !== topResult?.id);

  return (
    <div className="flex flex-col gap-6 pt-4">
      {/* Search Input */}
      <form onSubmit={handleSubmit} className="relative">
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
            focused
              ? "bg-white/10 border border-white/30"
              : "bg-white/5 border border-white/10"
          }`}
        >
          <SearchIcon className={`w-5 h-5 flex-shrink-0 ${focused ? "text-white" : "text-white/40"}`} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search tracks, artists..."
            value={localQuery}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="flex-1 bg-transparent outline-none text-white placeholder-white/30 text-base font-light"
          />
          {localQuery && (
            <button type="button" onClick={clear} className="p-1">
              <X className="w-4 h-4 text-white/40" />
            </button>
          )}
        </div>
        {searching && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-20 h-0.5 bg-blue-500 rounded-full animate-pulse" />
        )}
      </form>

      {/* Top Result */}
      <AnimatePresence mode="wait">
        {topResult && (
          <motion.section
            key="top"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-1.5">
              Top Result
              <AudioLines className="w-3.5 h-3.5 text-blue-400" />
            </h3>
            <div
              onClick={() => onPlay(topResult)}
              className="relative overflow-hidden rounded-xl h-40 cursor-pointer group border border-white/10 shadow-xl active:scale-[0.98] transition-transform"
            >
              <img src={topResult.coverLarge || topResult.cover} alt={topResult.title} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
              <div className="absolute bottom-0 left-0 p-4 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  {qualityBadge(topResult) && (
                    <span className={`px-1.5 py-0.5 rounded-sm text-[7px] font-bold uppercase tracking-widest border ${qualityBadge(topResult)!.cls}`}>
                      {qualityBadge(topResult)!.label}
                    </span>
                  )}
                  {aiScores.get(topResult.id) !== undefined && (
                    <span className="px-1.5 py-0.5 rounded-sm text-[7px] font-bold uppercase tracking-widest bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      AI {Math.round((aiScores.get(topResult.id) || 0) * 100)}%
                    </span>
                  )}
                </div>
                <h4 className="text-xl font-bold text-white tracking-tight">{topResult.title}</h4>
                <p className="text-[11px] text-white/50">{topResult.artist}</p>
              </div>
              <button className="absolute bottom-4 right-4 w-11 h-11 bg-blue-500 rounded-full flex items-center justify-center shadow-[0_0_16px_rgba(59,130,246,0.4)] active:scale-90">
                <Play className="w-5 h-5 fill-black text-black ml-0.5" />
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Track Results */}
      {trackResults.length > 0 && (
        <section>
          <h3 className="text-base font-bold text-white mb-2">Tracks</h3>
          <div className="flex flex-col gap-0.5">
            {trackResults.map((t) => {
              const badge = qualityBadge(t);
              const score = aiScores.get(t.id);
              return (
                <motion.div
                  key={t.id}
                  onClick={() => onPlay(t)}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer active:bg-white/5 transition-colors"
                >
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 shadow-md border border-white/5">
                    <img className="w-full h-full object-cover" src={t.cover} alt={t.title} />
                  </div>
                  <div className="flex-grow min-w-0">
                    <p className="text-sm text-white truncate">{t.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {badge && (
                        <span className={`px-1 py-0.5 rounded-sm text-[6px] font-bold uppercase tracking-widest border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      )}
                      <p className="text-[11px] text-white/40 truncate">{t.artist}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {score !== undefined && (
                      <div className="w-5 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500/80 rounded-full" style={{ width: `${Math.min(100, Math.max(0, score * 100))}%` }} />
                      </div>
                    )}
                    <span className="text-[10px] text-white/25">{fmtDuration(t.duration)}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {/* Empty state */}
      {searchResults.length === 0 && !searching && (
        <div className="flex flex-col items-center justify-center py-16 opacity-30">
          <SearchIcon className="w-10 h-10 mb-3" />
          <p className="text-base font-light">Search for music</p>
          <p className="text-[11px] text-white/40 mt-1">Find tracks, artists, and albums</p>
        </div>
      )}
    </div>
  );
}
