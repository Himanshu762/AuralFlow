"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Volume2, Volume1, VolumeX, ListMusic, Maximize2, AudioLines, AlertTriangle } from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";
import { fmtTime, qualityBadge } from "../lib/format";
import Rail from "./Rail";

interface Props {
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (time: number) => void;
  onVolume: (level: number) => void;
  onMute: (muted: boolean) => void;
}

export default function PlayerBar({ onToggle, onNext, onPrev, onSeek, onVolume, onMute }: Props) {
  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const loading = usePlayerStore((s) => s.loading);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const setIsExpanded = usePlayerStore((s) => s.setIsExpanded);
  const railOpen = usePlayerStore((s) => s.railOpen);
  const toggleRail = usePlayerStore((s) => s.toggleRail);
  const searchResults = usePlayerStore((s) => s.searchResults);
  const playbackConfigured = usePlayerStore((s) => s.playbackConfigured);
  const stalled = usePlayerStore((s) => s.stalled);
  const monoReady = usePlayerStore((s) => s.monoReady);

  const badge = track ? qualityBadge(track) : null;
  const isLiked = track ? liked.has(track.id) : false;
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const queueCount = track
    ? Math.max(0, searchResults.length - searchResults.findIndex((t) => t.id === track.id) - 1)
    : 0;

  const effectiveVolume = muted ? 0 : volume;
  const VolumeIcon = effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2;

  const handleVolume = (v: number) => onVolume(v);

  return (
    <div className="player-bar">
      {/* Thin progress line riding the top edge */}
      <div className="player-bar-edge">
        <div style={{ width: `${progressPct}%` }} />
      </div>

      {/* ---------------- Left: artwork + metadata ---------------- */}
      <div className="flex items-center gap-3.5 w-[26%] min-w-[220px]">
        {track ? (
          <>
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              aria-label="Open now playing"
              className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 shadow-[0_4px_12px_rgba(0,0,0,0.5)] ring-1 ring-white/10 group"
            >
              <img
                src={track.coverLarge || track.cover}
                alt=""
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <span className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Maximize2 className="w-4 h-4 text-white" />
              </span>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-label-md font-semibold text-on-surface truncate">{track.title}</span>
                <button
                  type="button"
                  onClick={() => toggleLike(track.id)}
                  aria-label={isLiked ? "Remove from liked songs" : "Add to liked songs"}
                  className={`flex-shrink-0 transition-colors active:scale-95 ${
                    isLiked ? "text-danger" : "text-outline hover:text-danger"
                  }`}
                >
                  <Heart className={`w-4 h-4 ${isLiked ? "fill-current" : ""}`} />
                </button>
              </div>
              <div className="text-[12px] text-outline truncate mt-0.5">{track.artist}</div>
              {stalled && (
                <div
                  className="flex items-start gap-1.5 mt-1.5 text-[11px] text-danger leading-snug"
                  role="status"
                >
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                  <span>{stalled}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1.5">
                {badge && (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${badge.cls}`}>
                    {badge.longLabel}
                  </span>
                )}
                {track.mood_label && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary-container/10 text-primary ring-1 ring-primary-container/30 truncate max-w-[110px]">
                    {track.mood_label}
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-lg bg-surface-high flex items-center justify-center flex-shrink-0">
              <AudioLines className="w-5 h-5 text-outline" />
            </div>
            <div className="min-w-0">
              <div className="text-label-md font-semibold text-on-surface-variant">
                {monoReady && !playbackConfigured ? "Playback unavailable" : "Nothing playing"}
              </div>
              <div className="text-[12px] text-outline truncate">
                {monoReady && !playbackConfigured
                  ? "No streaming endpoint configured — search still works"
                  : "Pick a track to start the flow"}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ---------------- Center: transport + progress ---------------- */}
      <div className="flex-1 flex flex-col items-center justify-center gap-2 max-w-2xl px-4">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={toggleShuffle}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            className={`transition-colors active:scale-95 ${shuffle ? "text-primary" : "text-outline hover:text-on-surface"}`}
          >
            <Shuffle className="w-[18px] h-[18px]" />
          </button>

          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous track"
            disabled={!track}
            className="text-on-surface hover:text-primary transition-colors active:scale-95 disabled:opacity-30"
          >
            <SkipBack className="w-[22px] h-[22px] fill-current" />
          </button>

          <motion.button
            type="button"
            onClick={onToggle}
            aria-label={playing ? "Pause" : "Play"}
            disabled={!track}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_16px_rgba(255,255,255,0.35)] disabled:opacity-30"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            ) : playing ? (
              <Pause className="w-5 h-5 fill-black" />
            ) : (
              <Play className="w-5 h-5 fill-black ml-0.5" />
            )}
          </motion.button>

          <button
            type="button"
            onClick={onNext}
            aria-label="Next track"
            disabled={!track}
            className="text-on-surface hover:text-primary transition-colors active:scale-95 disabled:opacity-30"
          >
            <SkipForward className="w-[22px] h-[22px] fill-current" />
          </button>

          <button
            type="button"
            onClick={cycleRepeat}
            aria-label={`Repeat: ${repeat}`}
            className={`transition-colors active:scale-95 ${repeat !== "off" ? "text-primary" : "text-outline hover:text-on-surface"}`}
          >
            {repeat === "one" ? <Repeat1 className="w-[18px] h-[18px]" /> : <Repeat className="w-[18px] h-[18px]" />}
          </button>
        </div>

        <div className="flex items-center gap-3 w-full">
          <span className="text-label-sm text-outline w-10 text-right tabular-nums">{fmtTime(currentTime)}</span>
          <Rail
            value={currentTime}
            max={duration}
            onChange={onSeek}
            onScrub={onSeek}
            ariaLabel="Seek"
            disabled={!track || duration === 0}
            className="flex-1"
          />
          <span className="text-label-sm text-outline w-10 tabular-nums">
            -{fmtTime(Math.max(0, duration - currentTime))}
          </span>
        </div>
      </div>

      {/* ---------------- Right: output + volume ---------------- */}
      <div className="flex items-center justify-end gap-4 w-[26%] min-w-[230px]">
        <button
          type="button"
          onClick={toggleRail}
          aria-label="Toggle audio engine panel"
          aria-pressed={railOpen}
          className={`relative transition-colors active:scale-95 ${railOpen ? "text-primary" : "text-outline hover:text-on-surface"}`}
        >
          <ListMusic className="w-[18px] h-[18px]" />
          {queueCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-primary-container text-on-primary-container text-[9px] font-bold flex items-center justify-center">
              {queueCount > 99 ? "99" : queueCount}
            </span>
          )}
        </button>

        {badge && (
          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container/60">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: badge.hex }} />
            <span className="text-label-sm text-on-surface-variant truncate max-w-[92px]">{badge.spec}</span>
          </div>
        )}

        <div className="flex items-center gap-2 w-28">
          <button
            type="button"
            onClick={() => onMute(!muted)}
            aria-label={muted ? "Unmute" : "Mute"}
            className="text-outline hover:text-on-surface transition-colors active:scale-95 flex-shrink-0"
          >
            <VolumeIcon className="w-4 h-4" />
          </button>
          <Rail
            value={effectiveVolume}
            max={1}
            onChange={handleVolume}
            onScrub={handleVolume}
            ariaLabel="Volume"
            className="flex-1"
          />
        </div>
      </div>
    </div>
  );
}
