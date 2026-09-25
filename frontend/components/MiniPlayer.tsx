"use client";

import React from "react";
import { motion } from "framer-motion";
import { Play, Pause, SkipForward, Cast } from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";
import { qualityBadge } from "../lib/format";

interface Props {
  onToggle: () => void;
  onNext: () => void;
}

/**
 * Compact transport that sits directly above the tab bar on phones.
 *
 * Tapping anywhere but the buttons raises the full Now Playing sheet —
 * the standard mobile music-app gesture.
 */
export default function MiniPlayer({ onToggle, onNext }: Props) {
  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const loading = usePlayerStore((s) => s.loading);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const setIsExpanded = usePlayerStore((s) => s.setIsExpanded);

  if (!track) return null;

  const badge = qualityBadge(track);
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <motion.div
      initial={{ y: 64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 64, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mini-player"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        setIsExpanded(true);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") setIsExpanded(true);
      }}
      aria-label={`Now playing ${track.title}. Open full player.`}
    >
      <div className="mini-player-progress">
        <div style={{ width: `${progressPct}%` }} />
      </div>

      <img
        src={track.coverLarge || track.cover}
        alt=""
        className="w-11 h-11 rounded-lg object-cover flex-shrink-0 shadow-lg"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-semibold text-on-surface truncate">{track.title}</span>
          {badge && (
            <span className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider flex-shrink-0 ${badge.cls}`}>
              {badge.label}
            </span>
          )}
        </div>
        <p className="text-[12px] text-outline truncate">{track.artist}</p>
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-label={playing ? "Pause" : "Play"}
        className="w-10 h-10 flex items-center justify-center text-on-surface active:scale-90 transition-transform flex-shrink-0"
      >
        {loading ? (
          <span className="w-4 h-4 border-2 border-on-surface border-t-transparent rounded-full animate-spin" />
        ) : playing ? (
          <Pause className="w-6 h-6 fill-current" />
        ) : (
          <Play className="w-6 h-6 fill-current" />
        )}
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          usePlayerStore.getState().setActiveTab("settings");
        }}
        aria-label="Output settings"
        className="w-10 h-10 flex items-center justify-center text-outline hover:text-on-surface active:scale-90 transition-all flex-shrink-0"
      >
        <Cast className="w-[18px] h-[18px]" />
      </button>

      <button
        type="button"
        onClick={onNext}
        aria-label="Next track"
        className="w-10 h-10 flex items-center justify-center text-on-surface active:scale-90 transition-transform flex-shrink-0"
      >
        <SkipForward className="w-5 h-5 fill-current" />
      </button>
    </motion.div>
  );
}
