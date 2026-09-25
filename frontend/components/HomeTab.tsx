"use client";

import React from "react";
import { motion } from "framer-motion";
import { Play, Shuffle, AudioLines, Heart, BadgeCheck, Disc3, Radio, Usb } from "lucide-react";
import { usePlayerStore, type Track } from "../stores/playerStore";
import { fmtTime, qualityBadge, streamCodec, pcmRate, MOOD_EMOJI, rankTracks } from "../lib/format";
import SectionHeading from "./SectionHeading";
import FlowCard from "./FlowCard";
import MoodMeter from "./MoodMeter";

interface Props {
  onPlay: (track: Track) => void;
  compact: boolean;
  dj: { playPick: () => void; reject: () => void; refresh: () => void; queuePick: () => void };
}

export default function HomeTab({ onPlay, compact, dj }: Props) {
  const searchResults = usePlayerStore((s) => s.searchResults);
  const recentlyPlayed = usePlayerStore((s) => s.recentlyPlayed);
  const track = usePlayerStore((s) => s.track);
  const aiScores = usePlayerStore((s) => s.aiScores);
  const aiRanking = usePlayerStore((s) => s.aiRanking);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const openAlbum = usePlayerStore((s) => s.openAlbum);
  const openArtist = usePlayerStore((s) => s.openArtist);
  const setActiveTab = usePlayerStore((s) => s.setActiveTab);
  const settings = usePlayerStore((s) => s.settings);
  const monoReady = usePlayerStore((s) => s.monoReady);
  const streamInfo = usePlayerStore((s) => s.streamInfo);
  const djState = usePlayerStore((s) => s.dj);
  const alternates = djState.alternates;

  const featured = searchResults[0];
  const featuredBadge = featured ? qualityBadge(featured, track?.id === featured.id ? streamInfo : null) : null;

  /* The agent ranks every candidate, including ones whose mood it could not
     read, so follow its order rather than re-sorting on the match score. */
  const forYou = rankTracks(searchResults, aiRanking).slice(0, compact ? 6 : 8);

  const recent = recentlyPlayed.length > 0 ? recentlyPlayed.slice(0, 12) : searchResults.slice(1, 13);

  const moodLabel = track?.mood_label || "Not read yet";
  const moodEmoji = MOOD_EMOJI[moodLabel] || "🎵";

  if (!featured && recent.length === 0 && !djState.pick) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-center">
        <AudioLines className={`w-12 h-12 mb-4 ${monoReady ? "text-outline" : "text-outline/50"}`} />
        <p className="text-headline-md text-on-surface-variant">
          {monoReady ? "Nothing here yet" : "Starting the audio engine"}
        </p>
        <p className="text-body-md text-outline mt-1.5 max-w-sm">
          {monoReady
            ? "Search for something, or bring your library across from another service in the Library tab."
            : "Connecting to the Monochrome audio engine."}
        </p>
        {monoReady && (
          <button
            type="button"
            onClick={() => setActiveTab("search")}
            className="mt-5 px-4 py-2 rounded-full bg-primary text-on-primary text-[13px] font-semibold"
          >
            Search
          </button>
        )}
      </div>
    );
  }

  const shuffleAll = () => {
    const pool = searchResults.length > 0 ? searchResults : recent;
    if (pool.length > 0) onPlay(pool[Math.floor(Math.random() * pool.length)]);
  };

  return (
    <div className={`flex flex-col ${compact ? "gap-7" : "gap-9"} max-w-[1500px]`}>
      {/* ================= The DJ ================= */}
      <section>
        <SectionHeading
          title="Flow"
          subtitle="Pick an arc; the DJ chooses what follows from your library and queues it"
          onSeeAll={() => setActiveTab("settings")}
          seeAllLabel="Tune"
        />
        <FlowCard
          compact={compact}
          onPlayPick={dj.playPick}
          onReject={dj.reject}
          onRefresh={dj.refresh}
          onQueuePick={dj.queuePick}
        />
      </section>

      {/* ================= Featured search result ================= */}
      {featured && (
        <section>
          <SectionHeading title="Top Result" subtitle="From your last search" />
          <div
            className={`relative overflow-hidden rounded-2xl bg-surface-low ring-1 ring-white/8 ${
              compact ? "p-4" : "p-5"
            }`}
          >
            <div className="ambient-glow -right-16 -top-16 w-72 h-72 bg-dolby-atmos/12" />
            <div className="ambient-glow -left-8 -bottom-10 w-56 h-56 bg-hi-res/10" />

            {/* Eyebrow chip row, from native_listen_now */}
            <div className="relative z-10 flex flex-wrap items-center gap-2 mb-4">
              <span className="text-label-sm uppercase tracking-[0.12em] text-outline font-bold">
                Top result
              </span>
              {featuredBadge && (
                <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${featuredBadge.cls}`}>
                  {featuredBadge.spec}
                </span>
              )}
              {featured.audioModes?.includes("DOLBY_ATMOS") && (
                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-dolby-atmos/10 text-dolby-atmos ring-1 ring-dolby-atmos/40">
                  Dolby Atmos
                </span>
              )}
            </div>

            <div className={`relative z-10 flex ${compact ? "flex-col gap-4" : "flex-row gap-5 items-center"}`}>
              <button
                type="button"
                onClick={() => onPlay(featured)}
                aria-label={`Play ${featured.title}`}
                className={`relative group rounded-xl overflow-hidden flex-shrink-0 shadow-2xl ring-1 ring-white/10 ${
                  compact ? "w-full aspect-square" : "w-36 h-36"
                }`}
              >
                <img
                  src={featured.coverLarge || featured.cover}
                  alt=""
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center shadow-xl">
                    <Play className="w-7 h-7 fill-current ml-0.5" />
                  </span>
                </span>
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {featuredBadge && (
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${featuredBadge.cls}`}>
                      {featuredBadge.longLabel}
                    </span>
                  )}
                  {aiScores.get(featured.id) !== undefined && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary-container/15 text-primary ring-1 ring-primary-container/40">
                      AI {Math.round((aiScores.get(featured.id) ?? 0) * 100)}%
                    </span>
                  )}
                </div>

                <h2 className={`${compact ? "text-headline-md" : "text-headline-lg"} text-on-surface line-clamp-2`}>
                  {featured.title}
                </h2>
                <p className="text-body-md text-on-surface-variant mt-1 truncate">
                  <button
                    type="button"
                    onClick={() => openArtist(featured)}
                    className="font-semibold text-on-surface hover:underline"
                  >
                    {featured.artist}
                  </button>
                  {featured.album && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => openAlbum(featured)}
                        className="hover:underline"
                      >
                        {featured.album}
                      </button>
                    </>
                  )}
                </p>

                <div className="flex items-center gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => onPlay(featured)}
                    aria-label="Play"
                    className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center active:scale-95 transition-transform shadow-lg"
                  >
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  </button>
                  <button
                    type="button"
                    onClick={shuffleAll}
                    aria-label="Shuffle play"
                    className="w-11 h-11 rounded-full bg-surface-container text-on-surface-variant hover:text-on-surface flex items-center justify-center active:scale-95 transition-all"
                  >
                    <Shuffle className="w-[18px] h-[18px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleLike(featured.id)}
                    aria-label={liked.has(featured.id) ? "Remove from liked songs" : "Add to liked songs"}
                    className={`w-11 h-11 rounded-full bg-surface-container flex items-center justify-center active:scale-95 transition-all ${
                      liked.has(featured.id) ? "text-danger" : "text-on-surface-variant hover:text-danger"
                    }`}
                  >
                    <Heart className={`w-5 h-5 ${liked.has(featured.id) ? "fill-current" : ""}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => openAlbum(featured)}
                    aria-label="View album"
                    className="w-11 h-11 rounded-full bg-surface-container text-on-surface-variant hover:text-on-surface flex items-center justify-center active:scale-95 transition-all"
                  >
                    <Disc3 className="w-[18px] h-[18px]" />
                  </button>
                  <span className="ml-auto text-[12px] text-outline font-mono">
                    {fmtTime(featured.duration)}
                  </span>
                </div>
              </div>
            </div>

            {/* Stream telemetry strip, from native_listen_now */}
            <div className="relative z-10 mt-5 pt-4 border-t border-white/8 flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="flex items-center gap-1.5 text-[12px]">
                <BadgeCheck className={`w-4 h-4 ${monoReady ? "text-lossless" : "text-outline"}`} />
                <span className="text-on-surface font-semibold">
                  {monoReady ? "Bit-perfect stream" : "Engine offline"}
                </span>
              </span>
              <span className="text-[12px] text-outline font-mono">
                {track?.id === featured.id ? (streamCodec(streamInfo) ?? "—") : "—"}
              </span>
              <span className="text-[12px] text-outline font-mono">
                {track?.id === featured.id ? (pcmRate(streamInfo) ?? "—") : "—"}
              </span>
              {featuredBadge && (
                <span className="text-[12px] font-semibold ml-auto" style={{ color: featuredBadge.hex }}>
                  {featuredBadge.longLabel}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ================= Mood Flow ================= */}
      <section>
        <SectionHeading
          title="Mood"
          subtitle="Measured from the audio as it plays; the ticks are where the arc is heading"
          onSeeAll={() => setActiveTab("settings")}
          seeAllLabel="Tune"
        />
        <div className={`rounded-2xl bg-surface-container/70 ${compact ? "p-4" : "p-5"} flex flex-col lg:flex-row lg:items-center gap-5`}>
          <div className="flex items-center gap-4 lg:w-64 flex-shrink-0">
            <span className="text-4xl">{moodEmoji}</span>
            <div className="min-w-0">
              <p className="text-headline-md text-on-surface truncate">{moodLabel}</p>
              <p className="text-[12px] text-outline mt-0.5">{track ? track.title : "Nothing playing"}</p>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <MoodMeter compact={compact} />
          </div>
        </div>
      </section>

      {/* ================= Recently played ================= */}
      {recent.length > 0 && (
        <section>
          <SectionHeading
            title={recentlyPlayed.length > 0 ? "Recently Played" : "Discover"}
            subtitle={recentlyPlayed.length > 0 ? "Jump back into your recent listening" : "Fresh from the catalogue"}
            onSeeAll={() => setActiveTab("library")}
          />

          {compact ? (
            /* Horizontal shelf — the phone pattern */
            <div className="flex gap-3.5 overflow-x-auto hide-scrollbar -mx-5 px-5 pb-1 snap-x">
              {recent.map((t, i) => (
                <ArtCard key={`${t.id}-${i}`} track={t} onPlay={onPlay} className="w-36 flex-none snap-start" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-5 items-start">
              {recent.map((t, i) => (
                <ArtCard
                  key={`${t.id}-${i}`}
                  track={t}
                  onPlay={onPlay}
                  /* Alternating offset gives the shelf the organic rhythm
                     of the Stitch vision boards. */
                  className={i % 3 === 1 ? "mt-6" : ""}
                  tall={i % 3 === 1}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================= Spatial immersion + output ================= */}
      <section className={`grid gap-4 ${compact ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2"}`}>
        <div className="relative overflow-hidden rounded-2xl bg-surface-low ring-1 ring-white/8 p-5">
          <div className="ambient-glow -right-10 -top-10 w-56 h-56 bg-dolby-atmos/15" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-3">
              <Radio className="w-4 h-4 text-dolby-atmos" />
              <span className="text-label-sm uppercase tracking-wider text-dolby-atmos font-bold">
                Spatial Immersion
              </span>
              <span className="ml-auto px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-dolby-atmos/10 text-dolby-atmos ring-1 ring-dolby-atmos/40">
                {settings.headTracking ? "Head-tracked" : "Binaural"}
              </span>
            </div>
            <p className="text-[15px] text-on-surface font-semibold">
              {settings.dolbyAtmos ? "Spatial masters enabled" : "Spatial masters off"}
            </p>
            <p className="text-[12px] text-outline mt-1 leading-relaxed">
              {settings.dolbyAtmos
                ? "Atmos mixes play in place of the stereo master whenever one exists."
                : "Turn Dolby Atmos on to play spatial masters when a track offers one."}
            </p>
            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              className="mt-4 px-4 py-2 rounded-full bg-white text-black text-[13px] font-semibold active:scale-95 transition-transform"
            >
              {settings.dolbyAtmos ? "Configure" : "Enable"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-surface-container/70 p-5 flex items-center gap-4">
          <span className="w-11 h-11 rounded-xl bg-lossless/10 ring-1 ring-lossless/30 flex items-center justify-center text-lossless flex-shrink-0">
            <Usb className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] text-on-surface font-semibold truncate">System Output</p>
            <p className="text-[12px] text-outline truncate mt-0.5">
              {settings.streamQuality === "hi-res"
                ? "Requesting 24-bit / 192 kHz"
                : settings.streamQuality === "lossless"
                  ? "Requesting 24-bit / 48 kHz"
                  : "Requesting 256 kbps"}
            </p>
          </div>
          <BadgeCheck className={`w-5 h-5 flex-shrink-0 ${monoReady ? "text-lossless" : "text-outline/50"}`} />
        </div>
      </section>

      {/* ================= Also in the running ================= */}
      {alternates.length > 0 && (
        <section>
          <SectionHeading
            accent
            title={
              <span className="flex items-center gap-2">
                Also in the Running
                <AudioLines className="w-4 h-4 text-primary animate-pulse" />
              </span>
            }
            subtitle="The DJ's runners-up from your library, for this arc"
            onSeeAll={() => setActiveTab("queue")}
          />
          <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2"}`}>
            {alternates.map((t) => {
              const badge = qualityBadge(t);
              const score = typeof t.fit === "number" ? t.fit : undefined;
              return (
                <motion.button
                  key={t.id}
                  type="button"
                  onClick={() => onPlay(t)}
                  whileTap={{ scale: 0.99 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  className="flex items-center gap-3.5 p-2.5 rounded-xl text-left hover:bg-surface-container transition-colors"
                >
                  {t.cover ? (
                    <img src={t.cover} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0 ring-1 ring-white/10" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-surface-high flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-on-surface truncate font-medium">{t.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {badge && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider flex-shrink-0 ${badge.cls}`}>
                          {badge.label}
                        </span>
                      )}
                      <span className="text-[11px] text-outline truncate">{t.artist}</span>
                      <span className={`text-[9px] uppercase tracking-wider font-bold flex-shrink-0 ${t.mood_source === "measured" ? "text-lossless" : "text-outline"}`}>
                        {t.mood_source === "measured" ? "Measured" : t.mood_source === "artist" ? "Artist prior" : t.mood_source === "genre" ? "Genre" : "Unread"}
                      </span>
                    </div>
                  </div>
                  {liked.has(t.id) && <Heart className="w-3.5 h-3.5 text-danger fill-current flex-shrink-0" />}
                  {score !== undefined && (
                    <div className="flex flex-col items-end gap-1 flex-shrink-0 w-12">
                      <span className="text-[10px] text-primary font-bold">{Math.round(score * 100)}%</span>
                      <div className="w-full h-1 bg-surface-high rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, Math.max(0, score * 100))}%` }} />
                      </div>
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>
        </section>
      )}

      {/* ================= For You (ranked search results) ================= */}
      {forYou.length > 0 && (
        <section>
          <SectionHeading
            accent
            title="From Your Search"
            subtitle="Ranked against your current mood"
            onSeeAll={() => setActiveTab("search")}
          />
          <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2"}`}>
            {forYou.map((t) => {
              const badge = qualityBadge(t);
              const score = aiScores.get(t.id);
              return (
                <motion.button
                  key={t.id}
                  type="button"
                  onClick={() => onPlay(t)}
                  whileTap={{ scale: 0.99 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  className="flex items-center gap-3.5 p-2.5 rounded-xl text-left hover:bg-surface-container transition-colors"
                >
                  <img
                    src={t.cover}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover flex-shrink-0 ring-1 ring-white/10"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-on-surface truncate font-medium">{t.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {badge && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider flex-shrink-0 ${badge.cls}`}>
                          {badge.label}
                        </span>
                      )}
                      <span className="text-[11px] text-outline truncate">{t.artist}</span>
                    </div>
                  </div>
                  {liked.has(t.id) && <Heart className="w-3.5 h-3.5 text-danger fill-current flex-shrink-0" />}
                  {score !== undefined && (
                    <div className="flex flex-col items-end gap-1 flex-shrink-0 w-12">
                      <span className="text-[10px] text-primary font-bold">{Math.round(score * 100)}%</span>
                      <div className="w-full h-1 bg-surface-high rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${Math.min(100, Math.max(0, score * 100))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ArtCard({
  track,
  onPlay,
  className = "",
  tall = false,
}: {
  track: Track;
  onPlay: (t: Track) => void;
  className?: string;
  tall?: boolean;
}) {
  const badge = qualityBadge(track);
  return (
    <motion.button
      type="button"
      onClick={() => onPlay(track)}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={`group text-left ${className}`}
    >
      <div
        className={`relative w-full ${tall ? "aspect-[3/4]" : "aspect-square"} rounded-xl overflow-hidden shadow-xl mb-2.5 ring-1 ring-white/5`}
      >
        <img src={track.coverLarge || track.cover} alt="" className="w-full h-full object-cover" />
        <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </span>
        </span>
        {badge && (
          <span className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>
      <p className="text-[13px] text-on-surface truncate font-medium">{track.title}</p>
      <p className="text-[11px] text-outline truncate mt-0.5">{track.artist}</p>
    </motion.button>
  );
}
