"use client";

import React, { useEffect, useRef, useState } from "react";
import { Play, Heart, ListPlus, Check } from "lucide-react";
import { usePlayerStore, type Track } from "../stores/playerStore";
import { fmtTime, qualityBadge } from "../lib/format";

interface Props {
  track: Track;
  index: number;
  onPlay: (t: Track) => void;
  /** AI confidence, 0..1. Omitted when the agent has not scored this track. */
  score?: number;
  /** Touch layouts keep the like button visible; pointer layouts reveal on hover. */
  touch?: boolean;
}

/**
 * One row of a track list.
 *
 * Columns collapse on the *container's* width, not the viewport's: these lists
 * sit beside the inspector rail, so a wide window does not mean a wide list.
 */
export default function TrackRow({ track, index, onPlay, score, touch = false }: Props) {
  const current = usePlayerStore((s) => s.track);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const playlists = usePlayerStore((s) => s.playlists);
  const addToPlaylist = usePlayerStore((s) => s.addToPlaylist);
  const createPlaylist = usePlayerStore((s) => s.createPlaylist);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Close on any click elsewhere, so the menu never outlives its row. */
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const badge = qualityBadge(track);
  const isLiked = liked.has(track.id);
  const isCurrent = current?.id === track.id;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPlay(track)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay(track);
        }
      }}
      className={`group grid gap-3 items-center px-3 py-2 rounded-lg cursor-pointer transition-colors outline-none focus-visible:ring-1 focus-visible:ring-primary-container
        grid-cols-[26px_40px_minmax(0,1fr)_52px_26px_26px]
        @[520px]:grid-cols-[26px_40px_minmax(0,1fr)_60px_52px_26px_26px]
        @[720px]:grid-cols-[26px_40px_minmax(0,1fr)_minmax(0,180px)_60px_52px_26px_26px]
        ${isCurrent ? "bg-surface-high" : "hover:bg-surface-container"}`}
    >
      {/* Index, swapped for an equalizer glyph on the playing track */}
      <span className="text-[12px] text-outline font-mono text-center">
        {isCurrent ? (
          <span className="flex items-end justify-center gap-0.5 h-3.5" aria-label="Now playing">
            <span className="eq-bar w-0.5 h-full bg-primary rounded-full" />
            <span className="eq-bar w-0.5 h-full bg-primary rounded-full" />
            <span className="eq-bar w-0.5 h-full bg-primary rounded-full" />
          </span>
        ) : (
          <>
            <span className="group-hover:hidden">{index + 1}</span>
            <Play className="w-3.5 h-3.5 hidden group-hover:block mx-auto fill-current text-on-surface" />
          </>
        )}
      </span>

      <img src={track.cover} alt="" className="w-10 h-10 rounded object-cover" />

      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[13px] truncate font-medium ${isCurrent ? "text-primary" : "text-on-surface"}`}>
            {track.title}
          </span>
          {badge && (
            <span className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider flex-shrink-0 ${badge.cls}`}>
              {badge.label}
            </span>
          )}
        </div>
        <span className="text-[11px] text-outline truncate block mt-0.5">{track.artist}</span>
      </div>

      {/* Album — only once the list is genuinely wide */}
      <span className="hidden @[720px]:block text-[12px] text-outline truncate">
        {track.album || "—"}
      </span>

      {/* AI confidence */}
      <span className="hidden @[520px]:block text-[11px] text-primary font-mono text-right">
        {score !== undefined ? `${Math.round(score * 100)}%` : "—"}
      </span>

      <span className="text-[11px] text-outline font-mono text-right">{fmtTime(track.duration)}</span>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleLike(track.id);
        }}
        aria-label={isLiked ? "Remove from liked songs" : "Add to liked songs"}
        className={`transition-all ${
          isLiked
            ? "text-danger"
            : touch
              ? "text-outline"
              : "text-outline opacity-0 group-hover:opacity-100 hover:text-danger"
        }`}
      >
        <Heart className={`w-4 h-4 ${isLiked ? "fill-current" : ""}`} />
      </button>

      {/* Add to a playlist. The menu is anchored here rather than being a
          global overlay so it cannot end up pointing at the wrong row. */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          aria-label={`Add ${track.title} to a playlist`}
          aria-expanded={menuOpen}
          className={`transition-all ${
            menuOpen
              ? "text-on-surface"
              : touch
                ? "text-outline"
                : "text-outline opacity-0 group-hover:opacity-100 hover:text-on-surface"
          }`}
        >
          <ListPlus className="w-4 h-4" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-full mt-1 z-30 w-52 rounded-xl bg-surface-high ring-1 ring-white/10 shadow-2xl overflow-hidden"
          >
            <div className="max-h-56 overflow-y-auto scroll-area">
              {playlists.length === 0 ? (
                <p className="px-3 py-2.5 text-[12px] text-outline">No playlists yet.</p>
              ) : (
                playlists.map((pl) => {
                  const already = pl.tracks.some((t) => t.id === track.id);
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      role="menuitem"
                      disabled={already}
                      onClick={() => {
                        addToPlaylist(pl.id, [track]);
                        setMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-container transition-colors disabled:opacity-50"
                    >
                      <span className="text-[12px] text-on-surface-variant truncate flex-1">
                        {pl.name}
                      </span>
                      {already && <Check className="w-3.5 h-3.5 text-lossless flex-shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                createPlaylist(`${track.artist} mix`, [track]);
                setMenuOpen(false);
              }}
              className="w-full px-3 py-2.5 text-left text-[12px] font-semibold text-primary hover:bg-surface-container transition-colors border-t border-white/8"
            >
              New playlist
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Column header matching TrackRow's grid, for lists wide enough to show it. */
export function TrackRowHeader() {
  return (
    <div
      className="hidden @[520px]:grid gap-3 items-center px-3 pb-2 mb-1 border-b border-white/6 text-[10px] uppercase tracking-wider text-outline font-bold
        @[520px]:grid-cols-[26px_40px_minmax(0,1fr)_60px_52px_26px_26px]
        @[720px]:grid-cols-[26px_40px_minmax(0,1fr)_minmax(0,180px)_60px_52px_26px_26px]"
    >
      <span>#</span>
      <span />
      <span>Title</span>
      <span className="hidden @[720px]:block">Album</span>
      <span className="text-right">AI</span>
      <span className="text-right">Time</span>
      <span />
      <span />
    </div>
  );
}
