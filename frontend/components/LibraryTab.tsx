"use client";

import React, { useEffect, useState } from "react";
import {
  Heart, Clock, Music2, Play, Search as SearchIcon, ChevronRight,
  ListMusic, Disc3, Download, Radio, CloudUpload, X, Library as LibraryIcon, Trash2,
} from "lucide-react";
import { usePlayerStore, type Track } from "../stores/playerStore";
import { fmtTime, qualityBadge } from "../lib/format";
import { uniqueTracks, groupAlbums, groupArtists } from "../lib/catalogue";
import TrackRow, { TrackRowHeader } from "./TrackRow";
import SectionHeading from "./SectionHeading";
import ImportPanel from "./ImportPanel";

/** Which collection the grouped list has drilled into. */
type Collection =
  | "overview" | "songs" | "albums" | "artists"
  | "liked" | "recent" | "spatial" | "playlists" | "offline";

interface Props {
  onPlay: (track: Track) => void;
  compact: boolean;
  /** Hands a playlist export to the engine to be matched. */
  onImport: (text: string, format: string, sourceName: string) => void;
  /** Lists what has been downloaded to the music folder. */
  onGetOffline: () => void;
  /** Plays a downloaded file. */
  onPlayOffline: (trackId: string, tracks: Track[]) => void;
}

export default function LibraryTab({ onPlay, compact, onImport, onGetOffline, onPlayOffline }: Props) {
  const liked = usePlayerStore((s) => s.liked);
  const recentlyPlayed = usePlayerStore((s) => s.recentlyPlayed);
  const searchResults = usePlayerStore((s) => s.searchResults);
  const openAlbum = usePlayerStore((s) => s.openAlbum);
  const openArtist = usePlayerStore((s) => s.openArtist);
  const monoReady = usePlayerStore((s) => s.monoReady);
  const playlists = usePlayerStore((s) => s.playlists);
  const offline = usePlayerStore((s) => s.offline);
  const deletePlaylist = usePlayerStore((s) => s.deletePlaylist);
  const renamePlaylist = usePlayerStore((s) => s.renamePlaylist);
  const removeFromPlaylist = usePlayerStore((s) => s.removeFromPlaylist);

  /* Which playlist's name is being edited, and the text so far. */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const [collection, setCollection] = useState<Collection>("overview");

  /* Ask the shell what is on disk once the engine is up, and again whenever
     the Downloaded list is opened — a download may have finished since. */
  useEffect(() => {
    if (monoReady) onGetOffline();
  }, [monoReady, collection, onGetOffline]);
  const [filter, setFilter] = useState("");

  const pool = uniqueTracks(recentlyPlayed, searchResults);
  const albums = groupAlbums(pool);
  const artists = groupArtists(pool);
  const likedTracks = pool.filter((t) => liked.has(t.id));
  const spatialTracks = pool.filter(
    (t) => t.audioModes?.includes("DOLBY_ATMOS") || t.audioQuality === "HI_RES_LOSSLESS"
  );

  /* "Find in Library" narrows whatever is on screen. */
  const q = filter.trim().toLowerCase();
  const matches = (t: Track) =>
    !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) ||
    (t.album ?? "").toLowerCase().includes(q);

  const rows: { id: Collection; label: string; icon: React.ElementType; count: string; badge?: { text: string; cls: string } }[] = [
    { id: "playlists", label: "Playlists", icon: LibraryIcon, count: `${playlists.length}` },
    { id: "offline", label: "Downloaded", icon: Download, count: `${offline.tracks.length}` },
    { id: "songs", label: "Songs", icon: Music2, count: `${pool.length}` },
    { id: "albums", label: "Albums", icon: Disc3, count: `${albums.length}` },
    { id: "artists", label: "Artists", icon: Radio, count: `${artists.length}` },
    { id: "liked", label: "Liked Songs", icon: Heart, count: `${likedTracks.length}` },
    { id: "recent", label: "Recently Played", icon: Clock, count: `${recentlyPlayed.length}` },
    {
      id: "spatial",
      label: "Spatial & Hi-Res",
      icon: ListMusic,
      count: `${spatialTracks.length}`,
      badge: { text: "ATMOS", cls: "bg-dolby-atmos/10 text-dolby-atmos ring-1 ring-dolby-atmos/40" },
    },
  ];

  const tracksFor = (c: Collection): Track[] => {
    switch (c) {
      case "songs": return pool;
      case "liked": return likedTracks;
      case "recent": return recentlyPlayed;
      case "spatial": return spatialTracks;
      case "playlists": return playlists.flatMap((p) => p.tracks);
      case "offline": return offline.tracks;
      default: return [];
    }
  };

  const listTracks = tracksFor(collection).filter(matches);
  const recentlyAdded = pool.filter(matches).slice(0, compact ? 6 : 8);

  return (
    <div className="flex flex-col gap-7 max-w-[1500px]">
      {/* Scoped search — "Find in Library" from the native board */}
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-surface-container ring-1 ring-white/8 max-w-xl">
        <SearchIcon className="w-4 h-4 text-outline flex-shrink-0" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find in Library"
          className="flex-1 bg-transparent outline-none text-on-surface placeholder-outline text-[14px]"
        />
        {filter && (
          <button type="button" onClick={() => setFilter("")} aria-label="Clear filter" className="text-outline hover:text-on-surface">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {collection === "overview" ? (
        <>
          {/* Grouped inset list */}
          <div className="rounded-2xl bg-surface-container/70 overflow-hidden max-w-xl">
            {rows.map(({ id, label, icon: Icon, count, badge }, i) => (
              <button
                key={id}
                type="button"
                onClick={() => setCollection(id)}
                className={`w-full flex items-center gap-3.5 px-4 py-3.5 hover:bg-surface-high transition-colors text-left ${
                  i > 0 ? "border-t border-white/6" : ""
                }`}
              >
                <span className="w-9 h-9 rounded-lg bg-primary-container/15 ring-1 ring-primary-container/30 flex items-center justify-center text-primary flex-shrink-0">
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <span className="flex-1 text-[15px] text-on-surface font-medium truncate">{label}</span>
                {badge && (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${badge.cls}`}>
                    {badge.text}
                  </span>
                )}
                <span className="text-[13px] text-outline font-mono">{count}</span>
                <ChevronRight className="w-4 h-4 text-outline/60 flex-shrink-0" />
              </button>
            ))}
          </div>

          {/* Recently added — 2-col art grid with stacked badges */}
          {recentlyAdded.length > 0 && (
            <section>
              <SectionHeading
                title="Recently Added"
                subtitle="Everything this session has pulled in"
                dot={recentlyPlayed.length > 0}
                onSeeAll={() => setCollection("songs")}
              />
              <div className={`grid gap-4 ${compact ? "grid-cols-2" : "grid-cols-[repeat(auto-fill,minmax(190px,1fr))]"}`}>
                {recentlyAdded.map((t) => {
                  const b = qualityBadge(t);
                  const atmos = t.audioModes?.includes("DOLBY_ATMOS");
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => openAlbum(t)}
                      className="group text-left"
                    >
                      <div className="relative w-full aspect-square rounded-xl overflow-hidden ring-1 ring-white/5 shadow-xl mb-2.5">
                        <img src={t.coverLarge || t.cover} alt="" className="w-full h-full object-cover" />
                        <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              onPlay(t);
                            }}
                            className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center shadow-lg"
                          >
                            <Play className="w-5 h-5 fill-current ml-0.5" />
                          </span>
                        </span>
                        {/* Stacked badges, as the native board shows them */}
                        <span className="absolute bottom-2 left-2 flex flex-wrap gap-1">
                          {b && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${b.cls}`}>
                              {b.label}
                            </span>
                          )}
                          {atmos && b?.label !== "Atmos" && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-dolby-atmos/10 text-dolby-atmos ring-1 ring-dolby-atmos/40">
                              Atmos
                            </span>
                          )}
                        </span>
                      </div>
                      <p className="text-[13px] text-on-surface font-medium truncate">{t.album || t.title}</p>
                      <p className="text-[11px] text-outline truncate mt-0.5">{t.artist}</p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Engine/cloud status card */}
          <div className="rounded-2xl bg-surface-container/70 p-4 flex items-center gap-3.5 max-w-xl">
            <span className="w-10 h-10 rounded-xl bg-lossless/10 ring-1 ring-lossless/30 flex items-center justify-center text-lossless flex-shrink-0">
              <CloudUpload className="w-5 h-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] text-on-surface font-semibold truncate">Lossless Stream</p>
              <p className="text-[12px] text-outline truncate">
                {monoReady
                  ? `${pool.length} tracks available · streamed on demand`
                  : "Audio engine not connected"}
              </p>
            </div>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${monoReady ? "bg-lossless animate-pulse" : "bg-outline/50"}`} />
          </div>

          {/* Bring a library across from another service */}
          <section>
            <SectionHeading
              title="Import a library"
              subtitle="Move what you already have from Spotify, Apple Music or anywhere else"
            />
            <div className="max-w-3xl">
              <ImportPanel onImport={onImport} compact={compact} />
            </div>
          </section>
        </>
      ) : (
        <>
          {/* Drill-down header */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCollection("overview")}
              className="px-3.5 py-2 rounded-full bg-surface-container hover:bg-surface-high text-[13px] font-medium text-on-surface-variant hover:text-on-surface transition-colors"
            >
              ← Library
            </button>
            <h2 className="text-headline-md text-on-surface truncate">
              {rows.find((r) => r.id === collection)?.label}
            </h2>
          </div>

          {collection === "playlists" && (
            playlists.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <LibraryIcon className="w-10 h-10 text-outline mb-3" />
                <p className="text-body-lg text-on-surface-variant">No playlists yet</p>
                <p className="text-body-md text-outline mt-1">
                  Import one from another service to get started.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-5 max-w-3xl">
                {playlists
                  .filter((pl) => !q || pl.name.toLowerCase().includes(q))
                  .map((pl) => (
                    <section key={pl.id} className="rounded-2xl bg-surface-container/70 overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/6">
                        <div className="min-w-0 flex-1">
                          {editing?.id === pl.id ? (
                            <input
                              autoFocus
                              value={editing.name}
                              onChange={(e) => setEditing({ id: pl.id, name: e.target.value })}
                              onBlur={() => {
                                const name = editing.name.trim();
                                if (name) renamePlaylist(pl.id, name);
                                setEditing(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                if (e.key === "Escape") setEditing(null);
                              }}
                              aria-label={`Rename ${pl.name}`}
                              className="w-full bg-surface-high rounded-lg px-2 py-1 text-[15px] font-semibold text-on-surface outline-none ring-1 ring-primary/40"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditing({ id: pl.id, name: pl.name })}
                              title="Rename"
                              className="block w-full text-left text-[15px] font-semibold text-on-surface truncate hover:text-primary transition-colors"
                            >
                              {pl.name}
                            </button>
                          )}
                          <p className="text-[11px] text-outline truncate">
                            {pl.tracks.length} track{pl.tracks.length === 1 ? "" : "s"}
                            {pl.source !== "auralflow" && ` · from ${pl.source}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => pl.tracks[0] && onPlay(pl.tracks[0])}
                          disabled={pl.tracks.length === 0}
                          aria-label={`Play ${pl.name}`}
                          className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center flex-shrink-0 disabled:opacity-30"
                        >
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePlaylist(pl.id)}
                          aria-label={`Delete ${pl.name}`}
                          className="w-9 h-9 rounded-full flex items-center justify-center text-outline hover:text-danger hover:bg-surface-high transition-colors flex-shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="divide-y divide-white/5">
                        {pl.tracks.filter(matches).slice(0, 50).map((t, i) => (
                          <TrackRow
                            key={t.id}
                            track={t}
                            index={i}
                            onPlay={onPlay}
                            onRemove={(track) => removeFromPlaylist(pl.id, track.id)}
                          />
                        ))}
                      </div>
                      {pl.tracks.length > 50 && (
                        <p className="px-4 py-2.5 text-[11px] text-outline">
                          Showing the first 50 of {pl.tracks.length}.
                        </p>
                      )}
                    </section>
                  ))}
              </div>
            )
          )}

          {collection === "albums" && (
            <div className={`grid gap-5 ${compact ? "grid-cols-2" : "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]"}`}>
              {albums
                .filter((a) => !q || a.album.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
                .map((a) => (
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
                    </div>
                    <p className="text-[13px] text-on-surface font-medium truncate">{a.album}</p>
                    <p className="text-[11px] text-outline truncate mt-0.5">{a.artist}</p>
                  </button>
                ))}
            </div>
          )}

          {collection === "artists" && (
            <div className={`grid gap-5 ${compact ? "grid-cols-2" : "grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"}`}>
              {artists
                .filter((a) => !q || a.artist.toLowerCase().includes(q))
                .map((a) => (
                  <button
                    key={a.artist}
                    type="button"
                    onClick={() => a.tracks[0] && openArtist(a.tracks[0])}
                    className="group text-center"
                  >
                    {/* Circular artist art, from library_vision_v2 */}
                    <div className="relative w-full aspect-square rounded-full overflow-hidden ring-1 ring-white/10 shadow-xl mb-3">
                      {a.cover ? (
                        <img src={a.cover} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-surface-high" />
                      )}
                    </div>
                    <p className="text-[13px] text-on-surface font-medium truncate">{a.artist}</p>
                    <p className="text-[10px] text-outline uppercase tracking-wider mt-0.5">Artist</p>
                  </button>
                ))}
            </div>
          )}

          {["songs", "liked", "recent", "spatial"].includes(collection) && (
            listTracks.length > 0 ? (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <span className="section-eyebrow">{listTracks.length} tracks</span>
                  <span className="section-eyebrow">
                    {fmtTime(listTracks.reduce((sum, t) => sum + (t.duration ?? 0), 0))}
                  </span>
                </div>
                <div className="@container rounded-xl bg-surface-low p-2 flex flex-col gap-0.5">
                  <TrackRowHeader />
                  {listTracks.map((t, i) => (
                    <TrackRow
                      key={`${t.id}-${i}`}
                      track={t}
                      index={i}
                      /* Downloaded files go through the shell's local URL
                         rather than the catalogue's stream resolution. */
                      onPlay={
                        collection === "offline"
                          ? () => onPlayOffline(t.id, listTracks)
                          : onPlay
                      }
                      touch={compact}
                    />
                  ))}
                </div>
              </section>
            ) : (
              <div className="flex flex-col items-center py-20 text-center">
                <Download className="w-10 h-10 text-outline mb-3" />
                <p className="text-body-md text-outline">
                  {q ? "Nothing matches that filter." : "Nothing here yet — play something to fill it."}
                </p>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
