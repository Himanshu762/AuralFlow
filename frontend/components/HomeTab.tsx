"use client";

import React from "react";
import { motion } from "framer-motion";
import { Play, AudioLines } from "lucide-react";
import { usePlayerStore, type Track } from "../stores/playerStore";

const MOOD_EMOJI: Record<string, string> = {
  "Energetic & Uplifting": "⚡",
  "Intense & Dark": "🔥",
  "Calm & Peaceful": "🌊",
  "Melancholic & Introspective": "🌙",
  "Danceable & Rhythmic": "💃",
  "Acoustic & Organic": "🎸",
  "Instrumental & Ambient": "🎹",
  Balanced: "🎵",
};

function qualityBadge(track: Track) {
  if (track.audioQuality === "HI_RES_LOSSLESS")
    return { label: "Hi-Res", cls: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
  if (track.audioQuality === "LOSSLESS")
    return { label: "Lossless", cls: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
  if (track.audioModes?.includes("DOLBY_ATMOS"))
    return { label: "Atmos", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  return null;
}

interface Props {
  onPlay: (track: Track) => void;
}

export default function HomeTab({ onPlay }: Props) {
  const searchResults = usePlayerStore((s) => s.searchResults);
  const recentlyPlayed = usePlayerStore((s) => s.recentlyPlayed);
  const currentMood = usePlayerStore((s) => s.currentMood);
  const track = usePlayerStore((s) => s.track);
  const aiScores = usePlayerStore((s) => s.aiScores);

  const heroTrack = searchResults[0];
  const forYou = [...searchResults]
    .sort((a, b) => (aiScores.get(b.id) || 0) - (aiScores.get(a.id) || 0))
    .slice(0, 6);
  const recent = recentlyPlayed.length > 0 ? recentlyPlayed.slice(0, 8) : searchResults.slice(1, 6);

  const moodLabel = track?.mood_label || "Balanced";
  const moodEmoji = MOOD_EMOJI[moodLabel] || "🎵";

  return (
    <div className="flex flex-col gap-8 pt-4">
      {/* Hero */}
      {heroTrack && (
        <section className="relative">
          <div
            className="relative w-full h-[260px] rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] group cursor-pointer border border-white/10"
            onClick={() => onPlay(heroTrack)}
          >
            <img
              className="w-full h-full object-cover transition-transform duration-[1.2s] ease-out group-active:scale-105"
              src={heroTrack.coverLarge || heroTrack.cover}
              alt={heroTrack.title}
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-black via-black/40 to-transparent" />
            <div className="absolute bottom-0 left-0 p-5 flex flex-col gap-1.5 w-full">
              <div className="flex items-center gap-2 mb-1">
                {qualityBadge(heroTrack) && (
                  <span className={`px-2 py-0.5 rounded-sm text-[8px] font-bold uppercase tracking-widest border backdrop-blur-sm ${qualityBadge(heroTrack)!.cls}`}>
                    {qualityBadge(heroTrack)!.label}
                  </span>
                )}
              </div>
              <h3 className="text-[28px] font-bold leading-[1.0] text-white line-clamp-2 tracking-tight drop-shadow-lg">
                {heroTrack.title}
              </h3>
              <p className="text-sm text-white/60 font-light">{heroTrack.artist}</p>
            </div>
            <button className="absolute bottom-5 right-5 w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center shadow-[0_0_16px_rgba(59,130,246,0.5)] active:scale-90 transition-all">
              <Play className="w-6 h-6 fill-black text-black ml-0.5" />
            </button>
          </div>
        </section>
      )}

      {/* Mood Flow */}
      <section>
        <h2 className="text-lg font-bold mb-3 text-white flex items-center gap-2">
          <span className="w-1 h-5 bg-blue-500 rounded-full" />
          Mood Flow
        </h2>
        <div className="glass-panel p-4 rounded-2xl flex items-center gap-3">
          <span className="text-3xl">{moodEmoji}</span>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-white">{moodLabel}</p>
            <p className="text-[11px] text-white/40">AI adapting to your vibe</p>
          </div>
          <div className="flex gap-0.5 h-7 items-end">
            {currentMood.map((v, i) => (
              <div key={i} className="w-1.5 bg-blue-500/80 rounded-full transition-all duration-700" style={{ height: `${Math.max(15, v * 100)}%` }} />
            ))}
          </div>
        </div>
      </section>

      {/* Recently Played / Discover */}
      {recent.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-4 text-white flex items-center gap-2">
            <span className="w-1 h-5 bg-blue-500 rounded-full" />
            {recentlyPlayed.length > 0 ? "Recently Played" : "Discover"}
          </h2>
          <div className="flex overflow-x-auto gap-4 hide-scrollbar pb-4 snap-x items-end min-h-[200px]">
            {recent.map((t, i) => (
              <div
                key={t.id}
                onClick={() => onPlay(t)}
                className={`flex-none snap-start group cursor-pointer ${i % 2 === 0 ? "w-36 pb-6" : "w-32 pb-0"}`}
              >
                <div className={`relative w-full ${i % 2 === 0 ? "aspect-[3/4]" : "aspect-square"} rounded-xl overflow-hidden shadow-xl mb-2 border border-white/5`}>
                  <img className="w-full h-full object-cover" src={t.coverLarge || t.cover} alt={t.title} />
                  <div className="absolute top-2 left-2">
                    {qualityBadge(t) && (
                      <span className={`px-1.5 py-0.5 rounded-sm text-[7px] font-bold uppercase tracking-widest border backdrop-blur-sm ${qualityBadge(t)!.cls}`}>
                        {qualityBadge(t)!.label}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-sm text-white truncate tracking-tight">{t.title}</p>
                <p className="text-[11px] text-white/40 truncate mt-0.5">{t.artist}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* For You (AI-Ranked) */}
      {forYou.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-4 text-white flex items-center gap-2">
            <span className="w-1 h-5 bg-blue-500 rounded-full" />
            For You
            <AudioLines className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
          </h2>
          <div className="flex flex-col gap-1.5">
            {forYou.map((t) => {
              const badge = qualityBadge(t);
              const score = aiScores.get(t.id);
              return (
                <motion.div
                  key={t.id}
                  onClick={() => onPlay(t)}
                  whileTap={{ scale: 0.98 }}
                  className="glass-panel flex items-center gap-3 p-3 rounded-xl cursor-pointer active:bg-white/5 transition-colors border border-white/10"
                >
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 shadow-lg border border-white/10">
                    <img className="w-full h-full object-cover" src={t.cover} alt={t.title} />
                  </div>
                  <div className="flex-grow min-w-0">
                    <p className="text-sm text-white truncate tracking-tight">{t.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {badge && (
                        <span className={`px-1.5 py-0.5 rounded-sm text-[7px] font-bold uppercase tracking-widest border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      )}
                      <p className="text-[11px] text-white/40 truncate">{t.artist}</p>
                    </div>
                  </div>
                  {score !== undefined && (
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <span className="text-[9px] text-blue-400 font-bold">{Math.round(score * 100)}%</span>
                      <div className="w-7 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, Math.max(0, score * 100))}%` }} />
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
