"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronDown, Heart, Shuffle, SkipBack, Play, Pause, SkipForward,
  Repeat, Repeat1, Volume2, Volume1, Speaker, ListMusic, AudioLines,
  MessageSquareText, Cast, MoreHorizontal, Mic2, Download, Check, Loader2,
} from "lucide-react";
import { usePlayerStore, WAVEFORM_BUCKETS } from "../stores/playerStore";
import { fmtTime, qualityBadge, streamCodec, pcmRate } from "../lib/format";
import Rail from "./Rail";
import LyricsPane from "./LyricsPane";

interface Props {
  compact: boolean;
  /** Fetches lyrics for the current track. */
  onFetchLyrics: () => void;
  /** Saves the current track to the music folder. */
  onDownload: () => void;
  onMinimize: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (time: number) => void;
  onVolume: (level: number) => void;
}

export default function NowPlayingScreen({
  compact, onMinimize, onPlayPause, onNext, onPrev, onSeek, onVolume,
  onFetchLyrics,
  onDownload,
}: Props) {
  const track = usePlayerStore((s) => s.track);
  const isPlaying = usePlayerStore((s) => s.playing);
  const loading = usePlayerStore((s) => s.loading);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const volume = usePlayerStore((s) => s.volume);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const setActiveTab = usePlayerStore((s) => s.setActiveTab);
  const openAlbum = usePlayerStore((s) => s.openAlbum);
  const monoReady = usePlayerStore((s) => s.monoReady);
  const streamInfo = usePlayerStore((s) => s.streamInfo);

  const [scrubTime, setScrubTime] = useState<number | null>(null);
  /* Lyrics take the place of the artwork rather than crowding beside it. */
  const [showLyrics, setShowLyrics] = useState(false);
  const download = usePlayerStore((s) => s.download);

  /* Measured amplitude envelope: each bar is the loudest RMS actually heard
     in that slice of the track. Unheard slices stay at a resting height. */
  const waveform = usePlayerStore((s) => s.waveform);

  if (!track) return null;

  const isLiked = liked.has(track.id);
  const badge = qualityBadge(track, streamInfo);
  const shown = scrubTime ?? currentTime;
  const progressPct = duration > 0 ? (shown / duration) * 100 : 0;
  const activeBars = Math.floor((progressPct / 100) * WAVEFORM_BUCKETS);

  const seekFromBarIndex = (i: number) => onSeek(((i + 0.5) / WAVEFORM_BUCKETS) * duration);

  /* ---------------- Shared fragments ---------------- */

  const artwork = (
    <div className="relative w-full h-full min-h-0 flex items-center justify-center">
      <div
        className="absolute inset-0 rounded-[28px] blur-3xl opacity-40"
        style={{ background: `radial-gradient(circle, ${badge?.hex ?? "#3e90ff"} 0%, transparent 70%)` }}
      />
      {/* Sized off whichever axis runs out first, so the square never
          overflows its flex track and paints over the metadata below. */}
      <img
        src={track.coverLarge || track.cover}
        alt=""
        className="relative aspect-square object-cover rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.8)] ring-1 ring-white/10"
        /* One width that already accounts for the height budget, so the
           square stays square instead of being capped on one axis. */
        style={{ width: compact ? "min(100%, 42vh)" : "min(100%, 460px, 62vh)" }}
      />
    </div>
  );

  const waveformStrip = (
    <div className="w-full">
      <div
        className="relative flex items-end justify-between gap-[2px] h-16 cursor-pointer"
        role="group"
        aria-label="Waveform seek"
      >
        {waveform.map((rms, i) => {
          const measured = rms >= 0;
          /* Unheard slices sit at a low resting height rather than pretending
             to know the level there. */
          const height = measured ? Math.max(6, Math.min(100, rms * 260)) : 5;
          return (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={() => seekFromBarIndex(i)}
              className={`flex-1 rounded-full transition-all duration-150 ${
                i < activeBars ? "bg-on-surface" : measured ? "bg-on-surface/35" : "bg-on-surface/12"
              }`}
              style={{ height: `${height}%` }}
            />
          );
        })}
      </div>
      {/* Tick rail under the waveform, as native_now_playing draws it */}
      <div className="mt-3 relative">
        <div className="absolute inset-x-0 -top-1.5 flex justify-between pointer-events-none px-0.5">
          {Array.from({ length: 21 }, (_, i) => (
            <span
              key={i}
              className={`w-px ${i % 5 === 0 ? "h-2" : "h-1"} ${
                i / 20 <= progressPct / 100 ? "bg-white/50" : "bg-white/15"
              }`}
            />
          ))}
        </div>
        <Rail
          value={shown}
          max={duration}
          onChange={(v) => {
            setScrubTime(null);
            onSeek(v);
          }}
          onScrub={setScrubTime}
          ariaLabel="Seek"
          disabled={duration === 0}
        />
      </div>
      <div className="flex justify-between items-center mt-2">
        <span className="text-[11px] font-semibold text-outline tabular-nums">{fmtTime(shown)}</span>
        <span className="text-[11px] font-semibold text-outline tabular-nums">
          -{fmtTime(Math.max(0, duration - shown))}
        </span>
      </div>
    </div>
  );

  const transport = (
    <div className="control-pod w-full px-6 py-6 relative overflow-hidden">
      <div className="oversized-time">{fmtTime(shown)}</div>

      <div className="relative z-10 flex items-center justify-between">
        <button
          type="button"
          onClick={toggleShuffle}
          aria-label="Shuffle"
          aria-pressed={shuffle}
          className={`p-2 active:scale-95 transition-colors ${shuffle ? "text-primary" : "text-on-surface/40"}`}
        >
          <Shuffle className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-center gap-5">
          <button onClick={onPrev} aria-label="Previous track" className="p-2 text-on-surface/70 hover:text-on-surface active:scale-95 transition-colors">
            <SkipBack className="w-8 h-8 fill-current" />
          </button>
          <button
            onClick={onPlayPause}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-black play-btn-glow active:scale-95 transition-transform"
          >
            {loading ? (
              <span className="w-6 h-6 border-[3px] border-black border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-8 h-8 fill-black" />
            ) : (
              <Play className="w-8 h-8 fill-black ml-1" />
            )}
          </button>
          <button onClick={onNext} aria-label="Next track" className="p-2 text-on-surface/70 hover:text-on-surface active:scale-95 transition-colors">
            <SkipForward className="w-8 h-8 fill-current" />
          </button>
        </div>

        <button
          type="button"
          onClick={cycleRepeat}
          aria-label={`Repeat: ${repeat}`}
          className={`p-2 active:scale-95 transition-colors ${repeat !== "off" ? "text-primary" : "text-on-surface/40"}`}
        >
          {repeat === "one" ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
        </button>
      </div>

      <div className="relative z-10 flex items-center gap-3 mt-5">
        <Volume1 className="w-4 h-4 text-on-surface/40 flex-shrink-0" />
        <Rail value={volume} max={1} onChange={onVolume} onScrub={onVolume} ariaLabel="Volume" className="flex-1" />
        <Volume2 className="w-4 h-4 text-on-surface/40 flex-shrink-0" />
      </div>
    </div>
  );

  const meta = (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className={`${compact ? "text-[30px]" : "text-headline-xl"} font-bold text-white leading-tight tracking-tight line-clamp-2`}>
            {track.title}
          </h1>
          <h2 className="text-body-lg font-light text-white/60 truncate uppercase tracking-[0.15em] mt-1.5">
            <button
              type="button"
              onClick={() => {
                usePlayerStore.getState().openArtist(track);
                onMinimize();
              }}
              className="hover:text-white transition-colors"
            >
              {track.artist}
            </button>
            {track.album && <span className="normal-case tracking-normal"> · {track.album}</span>}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => toggleLike(track.id)}
          aria-label={isLiked ? "Remove from liked songs" : "Add to liked songs"}
          className={`p-3 rounded-full backdrop-blur-md ring-1 transition-all active:scale-95 flex-shrink-0 ${
            isLiked ? "bg-danger/20 ring-danger/50 text-danger" : "bg-white/5 ring-white/10 text-white"
          }`}
        >
          <Heart className={`w-5 h-5 ${isLiked ? "fill-current" : ""}`} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        {badge && (
          <span
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.cls}`}
            style={{ boxShadow: `0 0 15px ${badge.hex}33` }}
          >
            <AudioLines className="w-3.5 h-3.5" />
            {badge.longLabel}
            <span className="font-mono font-normal normal-case tracking-normal opacity-70">
              · {badge.spec}
              {streamCodec(streamInfo) ? ` ${streamCodec(streamInfo)}` : ""}
            </span>
          </span>
        )}
        {pcmRate(streamInfo) && (
          <span className="px-3 py-1.5 rounded-full bg-white/5 ring-1 ring-white/10 text-[10px] font-mono text-white/60">
            {pcmRate(streamInfo)}
          </span>
        )}
        {track.mood_label && (
          <span className="px-3 py-1.5 rounded-full bg-primary-container/15 ring-1 ring-primary-container/40 text-[10px] font-bold uppercase tracking-wider text-primary">
            {track.mood_label}
          </span>
        )}
      </div>
    </div>
  );

  const bottomActions = (
    <div className="flex items-center justify-center gap-3 w-full">
      <button
        type="button"
        onClick={() => {
          usePlayerStore.getState().setRailTab("lyrics");
          usePlayerStore.getState().setRailOpen(true);
          onMinimize();
        }}
        className="px-4 py-2.5 rounded-full bg-white/8 backdrop-blur-md ring-1 ring-white/10 flex items-center gap-2 text-white/80 hover:text-white active:scale-95 transition-all"
      >
        <MessageSquareText className="w-4 h-4" />
        <span className="text-[12px] font-semibold">Insights</span>
      </button>

      <button
        type="button"
        onClick={onDownload}
        disabled={download.state === "started"}
        aria-label={
          download.state === "started"
            ? "Saving"
            : download.state === "done"
              ? "Saved to your music folder"
              : "Save to your music folder"
        }
        title={download.state === "error" ? download.message : undefined}
        className="w-11 h-11 rounded-full bg-white/8 backdrop-blur-md ring-1 ring-white/10 text-white/80 hover:text-white flex items-center justify-center active:scale-95 transition-all disabled:opacity-50"
      >
        {download.state === "started" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : download.state === "done" ? (
          <Check className="w-4 h-4 text-lossless" />
        ) : (
          <Download className={`w-4 h-4 ${download.state === "error" ? "text-danger" : ""}`} />
        )}
      </button>

      <button
        type="button"
        onClick={() => setActiveTab("settings")}
        aria-label="Output settings"
        className="w-11 h-11 rounded-full bg-white/8 backdrop-blur-md ring-1 ring-white/10 text-white/80 hover:text-white flex items-center justify-center active:scale-95 transition-all"
      >
        <Speaker className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => {
          setActiveTab("queue");
          onMinimize();
        }}
        aria-label="Show queue"
        className="w-11 h-11 rounded-full bg-white/8 backdrop-blur-md ring-1 ring-white/10 text-white/80 hover:text-white flex items-center justify-center active:scale-95 transition-all"
      >
        <ListMusic className="w-4 h-4" />
      </button>
    </div>
  );

  /* ---------------- Layout ---------------- */

  return (
    <motion.div
      initial={{ y: "100%", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "100%", opacity: 0 }}
      transition={{ type: "spring", damping: 30, stiffness: 260 }}
      className="fixed inset-0 z-[100] bg-bg-pure text-white flex flex-col overflow-hidden select-none"
    >
      {/* Bleed art background */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src={track.coverLarge || track.cover}
          alt=""
          className="w-full h-full object-cover opacity-30 blur-3xl scale-125 saturate-150"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/70 to-black" />
      </div>

      {/* Grabber / dismiss */}
      <header className="relative z-20 flex justify-between items-center py-3 px-5 safe-top flex-shrink-0">
        <button
          onClick={onMinimize}
          aria-label="Minimize now playing"
          className="p-2 -ml-2 rounded-full text-white/70 hover:text-white active:scale-95 transition-all"
        >
          <ChevronDown className="w-7 h-7" />
        </button>
        {/* Output destination pill */}
        <button
          type="button"
          onClick={() => setActiveTab("settings")}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/8 backdrop-blur-md ring-1 ring-white/10 text-white/80 hover:text-white transition-colors active:scale-95"
        >
          <Cast className={`w-3.5 h-3.5 ${monoReady ? "text-lossless" : "text-white/40"}`} />
          <span className="text-[10px] font-bold uppercase tracking-[0.12em]">System Output</span>
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowLyrics((v) => !v)}
            aria-label={showLyrics ? "Show artwork" : "Show lyrics"}
            aria-pressed={showLyrics}
            className={`p-2 rounded-full active:scale-95 transition-all ${
              showLyrics ? "text-white" : "text-white/70 hover:text-white"
            }`}
          >
            <Mic2 className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => openAlbum(track)}
            aria-label="Show album"
            className="p-2 -mr-2 rounded-full text-white/70 hover:text-white active:scale-95 transition-all"
          >
            <MoreHorizontal className="w-6 h-6" />
          </button>
        </div>
      </header>

      {compact ? (
        /* ---- Phone: stacked sheet ---- */
        <main className="relative z-20 flex-1 min-h-0 flex flex-col px-6 pb-6 gap-5 overflow-y-auto hide-scrollbar">
          <div className="flex-shrink-0 flex items-center justify-center py-1">
            {showLyrics ? (
              <div className="w-full h-[42vh]">
                <LyricsPane onFetch={onFetchLyrics} compact />
              </div>
            ) : (
              artwork
            )}
          </div>
          {meta}
          {waveformStrip}
          {transport}
          <div className="safe-bottom">{bottomActions}</div>
        </main>
      ) : (
        /* ---- Desktop: art left, controls right ---- */
        <main className="relative z-20 flex-1 min-h-0 grid grid-cols-[minmax(320px,40%)_1fr] gap-12 px-12 pb-10 items-center">
          <div className="h-full max-h-[70vh] flex items-center justify-center">
            {showLyrics ? (
              <div className="w-full h-full max-h-[70vh]">
                <LyricsPane onFetch={onFetchLyrics} compact={false} />
              </div>
            ) : (
              artwork
            )}
          </div>
          <div className="flex flex-col gap-7 max-w-2xl w-full">
            {meta}
            {waveformStrip}
            {transport}
            {bottomActions}
          </div>
        </main>
      )}
    </motion.div>
  );
}
