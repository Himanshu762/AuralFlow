"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronDown, MoreVertical, Heart, Shuffle,
  SkipBack, Play, Pause, SkipForward, Repeat,
  Volume2, Speaker, Mic2, AudioLines,
} from "lucide-react";
import { usePlayerStore, type Track } from "../stores/playerStore";

function fmtTime(s: number) {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function getQualityBadge(track: Track) {
  if (track.audioQuality === "HI_RES_LOSSLESS")
    return { label: "Hi-Res Lossless", color: "bg-purple-500/20 text-purple-400 border-purple-500/30 shadow-[0_0_12px_rgba(168,85,247,0.3)]", icon: "text-purple-400" };
  if (track.audioQuality === "LOSSLESS")
    return { label: "Lossless", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.3)]", icon: "text-emerald-400" };
  if (track.audioModes?.includes("DOLBY_ATMOS"))
    return { label: "Dolby Atmos", color: "bg-blue-500/20 text-blue-400 border-blue-500/30 shadow-[0_0_12px_rgba(59,130,246,0.3)]", icon: "text-blue-400" };
  return null;
}

interface NowPlayingScreenProps {
  onMinimize: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (time: number) => void;
  onVolume: (level: number) => void;
}

export default function NowPlayingScreen({
  onMinimize, onPlayPause, onNext, onPrev, onSeek, onVolume,
}: NowPlayingScreenProps) {
  const track = usePlayerStore((s) => s.track);
  const isPlaying = usePlayerStore((s) => s.playing);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const loading = usePlayerStore((s) => s.loading);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const storeVolume = usePlayerStore((s) => s.volume);

  const [localVolume, setLocalVolume] = useState(Math.round(storeVolume * 100));

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setLocalVolume(val);
    onVolume(val / 100);
  };

  if (!track) return null;

  const isLiked = liked.has(track.id);
  const badge = getQualityBadge(track);
  const progressPercent = (currentTime / Math.max(duration, 1)) * 100;
  const activeBarsCount = Math.floor((progressPercent / 100) * 20);

  const waveHeightsBg = useMemo(() => Array.from({ length: 20 }, () => 20 + Math.random() * 80), [track.id]);
  const waveHeightsFg = useMemo(() => Array.from({ length: 20 }, () => 10 + Math.random() * 90), [track.id]);

  return (
    <motion.div
      initial={{ y: "100%", opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: "100%", opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-[100] bg-black text-white flex flex-col h-[100dvh] w-full overflow-hidden select-none"
    >
      {/* Bleed Art Background */}
      <div className="absolute top-0 left-0 w-full h-[55vh] pointer-events-none" style={{ zIndex: 0 }}>
        <img
          src={track.coverLarge || track.cover}
          alt={track.title}
          className="w-full h-full object-cover opacity-70 mix-blend-luminosity scale-105 contrast-125 saturate-150"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/40 to-black" />
      </div>

      {/* Top Bar */}
      <header className="flex justify-between items-center py-3 px-5 w-full bg-transparent z-20">
        <button onClick={onMinimize} className="p-2 -ml-2 rounded-full text-white/70 active:scale-95 transition-all backdrop-blur-md">
          <ChevronDown className="w-7 h-7" />
        </button>
        <span className="text-[10px] font-bold text-white/50 uppercase tracking-[0.25em]">Now Playing</span>
        <button className="p-2 -mr-2 rounded-full text-white/70 active:scale-95 backdrop-blur-md">
          <MoreVertical className="w-6 h-6" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col justify-end w-full px-5 pb-8 z-20">
        {/* Track Info */}
        <div className="w-full flex flex-col items-start mb-6">
          <div className="flex justify-between items-end w-full mb-1">
            <div className="flex flex-col flex-1 pr-4 min-w-0">
              <h1 className="text-3xl font-black text-white truncate drop-shadow-lg leading-tight tracking-tight">
                {track.title}
              </h1>
              <h2 className="text-base font-light text-white/60 truncate uppercase tracking-widest mt-0.5">
                {track.artist}
              </h2>
            </div>
            <button
              onClick={() => toggleLike(track.id)}
              className={`p-2.5 rounded-full backdrop-blur-md border border-white/10 transition-all active:scale-95 ${
                isLiked ? "bg-red-500/20 border-red-500/50 text-red-500" : "bg-white/5 text-white"
              }`}
            >
              <Heart className={`w-5 h-5 ${isLiked ? "fill-current" : ""}`} />
            </button>
          </div>

          {badge && (
            <div className={`mt-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur-md ${badge.color}`}>
              <span className="text-[9px] font-bold uppercase tracking-wider">{badge.label}</span>
              <AudioLines className={`w-3.5 h-3.5 ${badge.icon}`} />
            </div>
          )}
        </div>

        {/* Waveform Progress */}
        <div className="w-full flex flex-col gap-2 mb-8">
          <div className="relative flex items-center justify-center h-14 w-full opacity-90 cursor-pointer group">
            <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-30">
              {waveHeightsBg.map((h, i) => (
                <div key={`bg-${i}`} className="flex-1 max-w-[5px] bg-white/50 rounded-full" style={{ height: `${h}%` }} />
              ))}
            </div>
            <div
              className="absolute inset-0 flex items-center justify-center gap-1 z-10"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                onSeek((x / rect.width) * duration);
              }}
            >
              {waveHeightsFg.map((h, i) => (
                <div
                  key={`fg-${i}`}
                  className={`flex-1 max-w-[5px] rounded-full transition-colors duration-300 ${i < activeBarsCount ? "bg-white" : "bg-white/30"}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-between items-center px-0.5">
            <span className="text-[11px] font-bold text-white/60 tracking-wider">{fmtTime(currentTime)}</span>
            <span className="text-[11px] font-bold text-white/60 tracking-wider">-{fmtTime(Math.max(0, duration - currentTime))}</span>
          </div>
        </div>

        {/* Control Pod */}
        <div className="control-pod w-full px-5 py-6 flex flex-col gap-5 relative overflow-hidden">
          <div className="oversized-time">{fmtTime(currentTime)}</div>
          <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none" />

          {/* Playback Controls */}
          <div className="flex items-center justify-between w-full relative z-10">
            <button className="p-2 text-white/40 active:scale-95">
              <Shuffle className="w-5 h-5" />
            </button>
            <div className="flex items-center justify-center gap-5">
              <button onClick={onPrev} className="p-2.5 text-white/70 active:scale-95">
                <SkipBack className="w-8 h-8 fill-current" />
              </button>
              <button
                onClick={onPlayPause}
                className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-black play-btn-glow active:scale-95 transition-all"
              >
                {loading ? (
                  <div className="w-6 h-6 border-3 border-black border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-8 h-8 fill-black" />
                ) : (
                  <Play className="w-8 h-8 fill-black ml-0.5" />
                )}
              </button>
              <button onClick={onNext} className="p-2.5 text-white/70 active:scale-95">
                <SkipForward className="w-8 h-8 fill-current" />
              </button>
            </div>
            <button className="p-2 text-white/40 active:scale-95">
              <Repeat className="w-5 h-5" />
            </button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-3 w-full mt-1 relative z-10">
            <Volume2 className="w-4 h-4 text-white/40" />
            <div className="relative w-full h-4 flex items-center flex-1">
              <input
                type="range"
                min="0"
                max="100"
                value={localVolume}
                onChange={handleVolumeChange}
                className="volume-track absolute w-full z-10"
                style={{ background: `linear-gradient(to right, #ffffff ${localVolume}%, rgba(255,255,255,0.15) ${localVolume}%)` }}
              />
            </div>
            <Volume2 className="w-4 h-4 text-white/40" />
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex justify-between items-center w-full mt-5 px-2 z-20">
          <button className="px-3 py-1.5 rounded-full bg-white/5 backdrop-blur-md border border-white/10 flex items-center gap-1.5 text-white/70 active:scale-95 transition-all">
            <Speaker className="w-4 h-4" />
            <span className="text-[11px] font-bold tracking-wide">Device</span>
          </button>
          <button className="p-2.5 rounded-full bg-white/5 backdrop-blur-md border border-white/10 text-white/70 active:scale-95 transition-all">
            <Mic2 className="w-4 h-4" />
          </button>
        </div>
      </main>
    </motion.div>
  );
}
