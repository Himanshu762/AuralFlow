"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Heart, Clock, Play, Music2 } from "lucide-react";
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

type Filter = "all" | "liked" | "recent";

interface Props {
  onPlay: (track: Track) => void;
}

export default function LibraryTab({ onPlay }: Props) {
  const liked = usePlayerStore((s) => s.liked);
  const recentlyPlayed = usePlayerStore((s) => s.recentlyPlayed);
  const searchResults = usePlayerStore((s) => s.searchResults);
  const [filter, setFilter] = useState<Filter>("all");

  const allTracks = [...recentlyPlayed, ...searchResults];
  const uniqueMap = new Map<string, Track>();
  allTracks.forEach((t) => { if (!uniqueMap.has(t.id)) uniqueMap.set(t.id, t); });

  const likedTracks = Array.from(uniqueMap.values()).filter((t) => liked.has(t.id));

  const displayTracks =
    filter === "liked"
      ? likedTracks
      : filter === "recent"
        ? recentlyPlayed
        : [...likedTracks, ...recentlyPlayed.filter((t) => !liked.has(t.id))].slice(0, 30);

  const filters: { id: Filter; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "all", label: "All", icon: <Music2 className="w-3.5 h-3.5" /> },
    { id: "liked", label: "Liked", icon: <Heart className="w-3.5 h-3.5" />, count: likedTracks.length },
    { id: "recent", label: "Recent", icon: <Clock className="w-3.5 h-3.5" />, count: recentlyPlayed.length },
  ];

  return (
    <div className="flex flex-col gap-5 pt-4">
      <h1 className="text-2xl font-bold tracking-tight">Your Library</h1>

      {/* Filter Chips */}
      <div className="flex gap-2 pb-1">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium transition-all whitespace-nowrap border ${
              filter === f.id
                ? "bg-white text-black border-white"
                : "bg-white/5 text-white/60 border-white/10 active:bg-white/10"
            }`}
          >
            {f.icon}
            {f.label}
            {f.count !== undefined && (
              <span className={`text-[11px] ${filter === f.id ? "text-black/50" : "text-white/30"}`}>{f.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Liked Songs Banner */}
      {filter !== "recent" && likedTracks.length > 0 && (
        <div className="relative overflow-hidden rounded-xl h-28 border border-white/10">
          <div className="absolute inset-0 bg-gradient-to-r from-red-500/30 via-purple-500/20 to-blue-500/30" />
          <div className="absolute inset-0 backdrop-blur-sm" />
          <div className="relative h-full flex items-center justify-between p-4">
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-0.5">Collection</p>
              <h3 className="text-xl font-bold text-white">Liked Songs</h3>
              <p className="text-[11px] text-white/40 mt-0.5">{likedTracks.length} songs</p>
            </div>
            <Heart className="w-8 h-8 text-red-400 fill-red-400 opacity-70" />
          </div>
        </div>
      )}

      {/* Track List */}
      <div className="flex flex-col gap-0.5">
        {displayTracks.map((t, i) => {
          const badge = qualityBadge(t);
          const isLiked = liked.has(t.id);
          return (
            <motion.div
              key={`${t.id}-${i}`}
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
              {isLiked && <Heart className="w-3.5 h-3.5 text-red-400 fill-red-400 flex-shrink-0" />}
            </motion.div>
          );
        })}
      </div>

      {/* Empty state */}
      {displayTracks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 opacity-30">
          <Music2 className="w-10 h-10 mb-3" />
          <p className="text-base font-light">
            {filter === "liked" ? "No liked songs yet" : filter === "recent" ? "No recent plays" : "Library is empty"}
          </p>
          <p className="text-[11px] text-white/40 mt-1">Play music to build your library</p>
        </div>
      )}
    </div>
  );
}
