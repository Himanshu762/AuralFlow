"use client";

import React from "react";
import { motion } from "framer-motion";
import { Play, Pause, AudioLines, ListMusic } from "lucide-react";
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
  onPlay: (track: Track) => void;
  onToggle: () => void;
}

export default function QueueTab({ onPlay, onToggle }: Props) {
  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const searchResults = usePlayerStore((s) => s.searchResults);
  const aiScores = usePlayerStore((s) => s.aiScores);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  const currentIdx = track ? searchResults.findIndex((t) => t.id === track.id) : -1;
  const upNext = currentIdx >= 0 ? searchResults.slice(currentIdx + 1) : searchResults;

  const aiSuggestions = [...searchResults]
    .filter((t) => t.id !== track?.id && !upNext.find((q) => q.id === t.id))
    .sort((a, b) => (aiScores.get(b.id) || 0) - (aiScores.get(a.id) || 0))
    .slice(0, 5);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex flex-col gap-6 pt-4">
      <h1 className="text-2xl font-bold tracking-tight">Queue</h1>

      {/* Now Playing Card */}
      {track && (
        <section>
          <p className="text-[10px] text-white/35 uppercase tracking-widest mb-2">Now Playing</p>
          <div className="relative overflow-hidden rounded-xl border border-white/10 shadow-xl">
            <div className="absolute inset-0">
              <img src={track.coverLarge || track.cover} alt="" className="w-full h-full object-cover opacity-30 blur-sm scale-110" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />

            <div className="relative p-4 flex items-center gap-3">
              <div className="relative w-14 h-14 rounded-xl overflow-hidden shadow-xl border border-white/10 flex-shrink-0">
                <img className="w-full h-full object-cover" src={track.coverLarge || track.cover} alt={track.title} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-white truncate">{track.title}</h3>
                <p className="text-[11px] text-white/40 truncate">{track.artist}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  {qualityBadge(track) && (
                    <span className={`px-1.5 py-0.5 rounded-sm text-[7px] font-bold uppercase tracking-widest border ${qualityBadge(track)!.cls}`}>
                      {qualityBadge(track)!.label}
                    </span>
                  )}
                  {track.mood_label && (
                    <span className="text-[9px] text-blue-400/70">{track.mood_label}</span>
                  )}
                </div>
              </div>
              <button
                onClick={onToggle}
                className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-black play-btn-glow active:scale-95 flex-shrink-0"
              >
                {playing ? <Pause className="w-5 h-5 fill-black" /> : <Play className="w-5 h-5 fill-black ml-0.5" />}
              </button>
            </div>

            <div className="relative h-[2px] bg-white/10">
              <div className="h-full bg-white transition-all duration-200" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </section>
      )}

      {/* Playing Next */}
      {upNext.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-white/35 uppercase tracking-widest">Playing Next</p>
            <span className="text-[10px] text-white/20">{upNext.length} tracks</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {upNext.slice(0, 10).map((t, i) => {
              const badge = qualityBadge(t);
              return (
                <motion.div
                  key={t.id}
                  onClick={() => onPlay(t)}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer active:bg-white/5 transition-colors"
                >
                  <span className="text-[10px] text-white/20 w-4 text-center font-mono">{i + 1}</span>
                  <div className="relative w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 shadow-md border border-white/5">
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
                  <span className="text-[10px] text-white/20 flex-shrink-0">{fmtDuration(t.duration)}</span>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {/* AI Suggestions */}
      {aiSuggestions.length > 0 && (
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <AudioLines className="w-3.5 h-3.5 text-blue-400" />
            <p className="text-[10px] text-blue-400 uppercase tracking-widest font-bold">AI Suggests</p>
          </div>
          <div className="flex flex-col gap-0.5">
            {aiSuggestions.map((t) => {
              const score = aiScores.get(t.id);
              return (
                <motion.div
                  key={t.id}
                  onClick={() => onPlay(t)}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer active:bg-blue-500/5 transition-colors border border-transparent"
                >
                  <div className="relative w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 shadow-md border border-blue-500/20">
                    <img className="w-full h-full object-cover" src={t.cover} alt={t.title} />
                  </div>
                  <div className="flex-grow min-w-0">
                    <p className="text-sm text-white truncate">{t.title}</p>
                    <p className="text-[11px] text-white/40 truncate">{t.artist}</p>
                  </div>
                  {score !== undefined && (
                    <span className="text-[9px] text-blue-400 font-bold flex-shrink-0">{Math.round(score * 100)}%</span>
                  )}
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!track && upNext.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 opacity-30">
          <ListMusic className="w-10 h-10 mb-3" />
          <p className="text-base font-light">Queue is empty</p>
          <p className="text-[11px] text-white/40 mt-1">Play something to start</p>
        </div>
      )}
    </div>
  );
}
