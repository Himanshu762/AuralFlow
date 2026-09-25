"use client";

import React from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Play, Heart, Radio } from "lucide-react";
import { usePlayerStore, type Track } from "../stores/playerStore";
import { fmtTime, qualityBadge } from "../lib/format";
import { findArtist, uniqueTracks } from "../lib/catalogue";
import SectionHeading from "./SectionHeading";

interface Props {
  artist: string;
  cover?: string;
  onPlay: (t: Track) => void;
  compact: boolean;
}

/**
 * Artist profile.
 *
 * Structure from `artist_profile_vision_v2`: full-bleed hero with the name
 * over it, a play/follow pair, a top-tracks list and a discography grid.
 * The board's bio and play counts have no source here, so those rows carry
 * what the session actually knows instead of invented numbers.
 */
export default function ArtistScreen({ artist, cover, onPlay, compact }: Props) {
  const searchResults = usePlayerStore((s) => s.searchResults);
  const recentlyPlayed = usePlayerStore((s) => s.recentlyPlayed);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const closeDetail = usePlayerStore((s) => s.closeDetail);
  const openAlbum = usePlayerStore((s) => s.openAlbum);
  const aiScores = usePlayerStore((s) => s.aiScores);

  const artistDetail = usePlayerStore((s) => s.artistDetail);

  /* Prefer the catalogue's own top tracks over whatever the last search
     happened to surface for this artist. */
  const pool = uniqueTracks(searchResults, recentlyPlayed);
  const group = findArtist(pool, artist);
  const fetched = artistDetail && !artistDetail.error ? artistDetail : null;
  const tracks = fetched && fetched.tracks.length > 0 ? fetched.tracks : (group?.tracks ?? []);
  const art = group?.cover || cover;

  /* "Frequencies" in the board — ranked by the agent rather than play counts,
     which we do not have. */
  const topTracks = [...tracks]
    .sort((a, b) => (aiScores.get(b.id) ?? 0) - (aiScores.get(a.id) ?? 0))
    .slice(0, 5);

  const albums = group?.albums ?? [];
  const isFollowed = tracks.length > 0 && tracks.every((t) => liked.has(t.id));

  const followAll = () => tracks.forEach((t) => !liked.has(t.id) && toggleLike(t.id));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="max-w-[1100px] mx-auto"
    >
      {/* Hero */}
      <div className="relative -mx-8 -mt-7 mb-7 overflow-hidden">
        <div className={`relative ${compact ? "h-64" : "h-80"}`}>
          {art ? (
            <img src={art} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 bg-surface-high" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-bg-pure via-bg-pure/70 to-bg-pure/20" />

          <button
            type="button"
            onClick={closeDetail}
            aria-label="Back"
            className="absolute top-5 left-8 w-9 h-9 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center active:scale-95 transition-transform"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="absolute bottom-0 left-0 right-0 px-8 pb-5">
            <p className="section-eyebrow mb-1.5">Artist</p>
            <h1 className={`${compact ? "text-headline-lg" : "text-headline-xl"} text-white line-clamp-2`}>
              {artist}
            </h1>
            <p className="text-[13px] text-white/60 mt-1.5">
              {tracks.length} {tracks.length === 1 ? "track" : "tracks"} in this session
              {albums.length > 0 && ` · ${albums.length} ${albums.length === 1 ? "release" : "releases"}`}
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2.5 mb-8">
        <button
          type="button"
          onClick={() => tracks[0] && onPlay(tracks[0])}
          disabled={tracks.length === 0}
          className="px-7 py-3 rounded-full bg-primary text-on-primary font-semibold text-[14px] flex items-center gap-2 active:scale-95 transition-transform shadow-lg disabled:opacity-30"
        >
          <Play className="w-4 h-4 fill-current" />
          Play Artist
        </button>
        <button
          type="button"
          onClick={followAll}
          disabled={tracks.length === 0}
          className={`px-6 py-3 rounded-full font-semibold text-[14px] flex items-center gap-2 active:scale-95 transition-all disabled:opacity-30 ${
            isFollowed
              ? "bg-danger/15 text-danger ring-1 ring-danger/40"
              : "bg-surface-container hover:bg-surface-high text-on-surface"
          }`}
        >
          <Heart className={`w-4 h-4 ${isFollowed ? "fill-current" : ""}`} />
          {isFollowed ? "Following" : "Follow"}
        </button>
      </div>

      {/* Top tracks */}
      {topTracks.length > 0 && (
        <section className="mb-9">
          <SectionHeading title="Frequencies" subtitle="Ranked by the agent against your current mood" accent />
          <div className="rounded-xl bg-surface-low p-2 flex flex-col gap-0.5">
            {topTracks.map((t, i) => {
              const b = qualityBadge(t);
              const score = aiScores.get(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPlay(t)}
                  className="group flex items-center gap-3.5 px-3 py-2.5 rounded-lg hover:bg-surface-container transition-colors text-left"
                >
                  <span className="w-5 text-center text-[13px] text-outline font-mono flex-shrink-0">{i + 1}</span>
                  <img src={t.cover} alt="" className="w-11 h-11 rounded object-cover flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] text-on-surface font-medium truncate">{t.title}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {score !== undefined && (
                        <span className="text-[11px] text-primary font-mono">{Math.round(score * 100)}% match</span>
                      )}
                      {b && (
                        <span className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${b.cls}`}>
                          {b.label}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[12px] text-outline font-mono flex-shrink-0">{fmtTime(t.duration)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Discography */}
      {albums.length > 0 && (
        <section>
          <SectionHeading title="Discography" subtitle="Releases seen in this session" />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
            {albums.map((a) => (
              <button
                key={`${a.album}-${a.artist}`}
                type="button"
                onClick={() => a.tracks[0] && openAlbum(a.tracks[0])}
                className="group text-left"
              >
                <div className="relative w-full aspect-square rounded-xl overflow-hidden ring-1 ring-white/5 shadow-xl mb-2.5">
                  {a.cover ? (
                    <img src={a.cover} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-surface-high" />
                  )}
                  <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                    </span>
                  </span>
                </div>
                <p className="text-[13px] text-on-surface font-medium truncate">{a.album}</p>
                <p className="text-[11px] text-outline truncate mt-0.5">
                  {a.tracks.length} {a.tracks.length === 1 ? "track" : "tracks"}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {tracks.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <Radio className="w-10 h-10 text-outline mb-3" />
          <p className="text-body-md text-outline">Nothing by this artist is loaded yet.</p>
        </div>
      )}
    </motion.div>
  );
}
