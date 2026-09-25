"use client";

import React from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Play, Shuffle, Heart, Sparkles, MoreHorizontal } from "lucide-react";
import { usePlayerStore, type Track } from "../stores/playerStore";
import { fmtTime, qualityBadge, streamCodec, pcmRate } from "../lib/format";
import { findAlbum, uniqueTracks, albumMeta } from "../lib/catalogue";

interface Props {
  album: string;
  artist: string;
  cover?: string;
  onPlay: (t: Track) => void;
  compact: boolean;
}

/**
 * Album detail.
 *
 * Layout from `native_album_details` (centred hero, quality pill pair,
 * Play/Shuffle pair, tracklist with a duration column, specs card) with the
 * mood blurb sitting where that board puts its editorial copy.
 */
export default function AlbumScreen({ album, artist, cover, onPlay, compact }: Props) {
  const searchResults = usePlayerStore((s) => s.searchResults);
  const recentlyPlayed = usePlayerStore((s) => s.recentlyPlayed);
  const current = usePlayerStore((s) => s.track);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const closeDetail = usePlayerStore((s) => s.closeDetail);
  const streamInfo = usePlayerStore((s) => s.streamInfo);
  const openArtist = usePlayerStore((s) => s.openArtist);

  const albumDetail = usePlayerStore((s) => s.albumDetail);

  /* The catalogue's own track list is the real record. Filtering the current
     search results only ever showed the handful of tracks that happened to be
     in it, so fall back to that only while the fetch is in flight or when the
     record has no id to fetch by. */
  const pool = uniqueTracks(searchResults, recentlyPlayed);
  const group = findAlbum(pool, album, artist);
  const fetched = albumDetail && !albumDetail.error ? albumDetail : null;
  const tracks = fetched && fetched.tracks.length > 0 ? fetched.tracks : (group?.tracks ?? []);
  const art = fetched?.cover || group?.cover || cover;
  const loading = !fetched && !albumDetail;

  /* Best quality present anywhere on the record, as the boards show it. */
  const badges = Array.from(
    new Map(
      tracks
        .map((t) => qualityBadge(t))
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map((b) => [b.label, b])
    ).values()
  );

  const playAll = () => tracks[0] && onPlay(tracks[0]);
  const shuffleAll = () =>
    tracks.length > 0 && onPlay(tracks[Math.floor(Math.random() * tracks.length)]);

  const moodTrack = tracks.find((t) => t.mood_label);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="max-w-[1100px] mx-auto"
    >
      {/* Back row */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={closeDetail}
          aria-label="Back"
          className="w-9 h-9 rounded-full bg-surface-container hover:bg-surface-high text-on-surface flex items-center justify-center transition-colors active:scale-95 flex-shrink-0"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="section-eyebrow">Album</span>
      </div>

      {/* Hero */}
      <div className={`flex ${compact ? "flex-col items-center text-center gap-5" : "flex-row items-end gap-7"} mb-7`}>
        <div className="relative flex-shrink-0">
          <div
            className="absolute -inset-6 rounded-full blur-3xl opacity-40 pointer-events-none"
            style={{ background: `radial-gradient(circle, ${badges[0]?.hex ?? "#3e90ff"} 0%, transparent 70%)` }}
          />
          {art ? (
            <img
              src={art}
              alt=""
              className={`relative rounded-2xl object-cover shadow-2xl ring-1 ring-white/10 ${
                compact ? "w-56 h-56" : "w-60 h-60"
              }`}
            />
          ) : (
            <div className={`relative rounded-2xl bg-surface-high ${compact ? "w-56 h-56" : "w-60 h-60"}`} />
          )}
        </div>

        <div className={`min-w-0 flex-1 ${compact ? "" : "pb-2"}`}>
          <h1 className={`${compact ? "text-headline-lg" : "text-headline-xl"} text-on-surface line-clamp-2`}>
            {album}
          </h1>

          <button
            type="button"
            onClick={() => tracks[0] && openArtist(tracks[0])}
            className="text-body-lg text-primary font-semibold mt-1.5 hover:underline truncate block"
          >
            {artist}
          </button>

          <p className="text-[13px] text-outline mt-1">
            {loading
              ? "Loading…"
              : tracks.length > 0
                ? `${tracks.length} track${tracks.length === 1 ? "" : "s"}${
                    fetched?.year ? ` · ${fetched.year}` : group ? ` · ${albumMeta(group)}` : ""
                  }`
                : albumDetail?.error
                  ? "This album could not be loaded."
                  : "No tracks found for this album."}
          </p>

          {badges.length > 0 && (
            <div className={`flex flex-wrap items-center gap-2 mt-3.5 ${compact ? "justify-center" : ""}`}>
              {badges.map((b) => (
                <span
                  key={b.label}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${b.cls}`}
                >
                  {b.longLabel} · {b.spec}
                </span>
              ))}
            </div>
          )}

          {/* Play / Shuffle pair */}
          <div className={`flex items-center gap-2.5 mt-5 ${compact ? "justify-center" : ""}`}>
            <button
              type="button"
              onClick={playAll}
              disabled={tracks.length === 0}
              className="px-7 py-3 rounded-full bg-white text-black font-semibold text-[14px] flex items-center gap-2 active:scale-95 transition-transform shadow-lg disabled:opacity-30"
            >
              <Play className="w-4 h-4 fill-current" />
              Play
            </button>
            <button
              type="button"
              onClick={shuffleAll}
              disabled={tracks.length === 0}
              className="px-6 py-3 rounded-full bg-surface-container hover:bg-surface-high text-on-surface font-semibold text-[14px] flex items-center gap-2 active:scale-95 transition-all disabled:opacity-30"
            >
              <Shuffle className="w-4 h-4" />
              Shuffle
            </button>
          </div>
        </div>
      </div>

      {/* Mood read — the boards put editorial copy here */}
      {moodTrack?.mood_label && (
        <div className="rounded-xl bg-surface-container/70 p-4 flex items-start gap-3 mb-6">
          <Sparkles className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-[13px] text-on-surface-variant leading-relaxed">
            The agent reads this record as{" "}
            <span className="text-primary font-semibold">{moodTrack.mood_label}</span>
            {tracks.length > 1 ? `, mapped across ${tracks.length} tracks.` : "."}
          </p>
        </div>
      )}

      {/* Tracklist */}
      {tracks.length > 0 ? (
        <section className="@container">
          <div className="flex items-center justify-between px-3 mb-2">
            <span className="section-eyebrow">Tracklist</span>
            <span className="section-eyebrow">Duration</span>
          </div>

          <div className="rounded-xl bg-surface-low p-2 flex flex-col gap-0.5">
            {tracks.map((t, i) => {
              const b = qualityBadge(t);
              const isCurrent = current?.id === t.id;
              const isLiked = liked.has(t.id);
              return (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPlay(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPlay(t);
                    }
                  }}
                  className={`group flex items-center gap-3.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors outline-none focus-visible:ring-1 focus-visible:ring-primary-container ${
                    isCurrent ? "bg-surface-high" : "hover:bg-surface-container"
                  }`}
                >
                  <span className="w-5 text-center text-[12px] text-outline font-mono flex-shrink-0">
                    {isCurrent ? (
                      <span className="flex items-end justify-center gap-0.5 h-3.5">
                        <span className="eq-bar w-0.5 h-full bg-lossless rounded-full" />
                        <span className="eq-bar w-0.5 h-full bg-lossless rounded-full" />
                        <span className="eq-bar w-0.5 h-full bg-lossless rounded-full" />
                      </span>
                    ) : (
                      <>
                        <span className="group-hover:hidden">{i + 1}</span>
                        <Play className="w-3.5 h-3.5 hidden group-hover:block mx-auto fill-current text-on-surface" />
                      </>
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className={`text-[14px] font-medium truncate ${isCurrent ? "text-lossless" : "text-on-surface"}`}>
                      {t.title}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-outline truncate">{t.artist}</span>
                      {b && (
                        <span className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider flex-shrink-0 ${b.cls}`}>
                          {b.label}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="text-[12px] text-outline font-mono flex-shrink-0">{fmtTime(t.duration)}</span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLike(t.id);
                    }}
                    aria-label={isLiked ? "Remove from liked songs" : "Add to liked songs"}
                    className={`flex-shrink-0 transition-all ${
                      isLiked ? "text-danger" : compact ? "text-outline" : "text-outline opacity-0 group-hover:opacity-100 hover:text-danger"
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${isLiked ? "fill-current" : ""}`} />
                  </button>

                  <MoreHorizontal className="w-4 h-4 text-outline/40 flex-shrink-0 hidden @[420px]:block" />
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <p className="text-[13px] text-outline px-1 py-8 text-center">
          No tracks for this album are loaded yet. Search for it to pull the record in.
        </p>
      )}

      {/* Format specs — the boards' "mastering specs" card, with what we know */}
      {tracks.length > 0 && (
        <div className="mt-6 rounded-xl bg-surface-container/60 p-4">
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <span className="section-eyebrow">Format</span>
            <span className="text-label-sm text-lossless font-semibold">
              {badges[0]?.longLabel ?? "Standard"}
            </span>
          </div>
          <div className="grid grid-cols-2 @[520px]:grid-cols-3 gap-2">
            {/* Codec and rate are only known for the track the engine has
                actually resolved; the rest of the record shows its tier. */}
            <SpecCell
              label="Codec"
              value={tracks.some((t) => t.id === current?.id) ? (streamCodec(streamInfo) ?? "—") : "—"}
            />
            <SpecCell
              label="PCM Rate"
              value={tracks.some((t) => t.id === current?.id) ? (pcmRate(streamInfo) ?? "—") : "—"}
            />
            <SpecCell label="Runtime" value={fmtTime(group?.runtime)} />
          </div>
        </div>
      )}
    </motion.div>
  );
}

function SpecCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-surface-low">
      <div className="text-[10px] text-outline uppercase tracking-wide">{label}</div>
      <div className="text-[13px] text-on-surface font-semibold font-mono mt-0.5 truncate">{value}</div>
    </div>
  );
}
