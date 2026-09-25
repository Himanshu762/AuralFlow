/**
 * Grouping helpers.
 *
 * The catalogue hands us tracks, not albums or artists, so the album and
 * artist screens are derived by grouping whatever tracks the session has seen.
 * Nothing here invents metadata: counts and runtimes are computed from the
 * tracks actually present.
 */

import type { Track } from "../stores/playerStore";

export interface AlbumGroup {
  album: string;
  artist: string;
  cover?: string;
  tracks: Track[];
  /** Summed duration of the tracks we know about, in seconds. */
  runtime: number;
}

export interface ArtistGroup {
  artist: string;
  cover?: string;
  tracks: Track[];
  albums: AlbumGroup[];
}

/** De-duplicate by track id, preserving first-seen order. */
export function uniqueTracks(...lists: Track[][]): Track[] {
  const seen = new Map<string, Track>();
  for (const list of lists) {
    for (const t of list) if (!seen.has(t.id)) seen.set(t.id, t);
  }
  return Array.from(seen.values());
}

export function groupAlbums(tracks: Track[]): AlbumGroup[] {
  const map = new Map<string, AlbumGroup>();
  for (const t of tracks) {
    const album = t.album || t.title;
    const key = `${album}::${t.artist}`;
    const existing = map.get(key);
    if (existing) {
      existing.tracks.push(t);
      existing.runtime += t.duration ?? 0;
      if (!existing.cover) existing.cover = t.coverLarge || t.cover;
    } else {
      map.set(key, {
        album,
        artist: t.artist,
        cover: t.coverLarge || t.cover,
        tracks: [t],
        runtime: t.duration ?? 0,
      });
    }
  }
  return Array.from(map.values());
}

export function groupArtists(tracks: Track[]): ArtistGroup[] {
  const map = new Map<string, Track[]>();
  for (const t of tracks) {
    const list = map.get(t.artist);
    if (list) list.push(t);
    else map.set(t.artist, [t]);
  }
  return Array.from(map.entries()).map(([artist, list]) => ({
    artist,
    cover: list[0]?.coverLarge || list[0]?.cover,
    tracks: list,
    albums: groupAlbums(list),
  }));
}

export function findAlbum(tracks: Track[], album: string, artist: string): AlbumGroup | null {
  return (
    groupAlbums(tracks).find((a) => a.album === album && a.artist === artist) ?? null
  );
}

export function findArtist(tracks: Track[], artist: string): ArtistGroup | null {
  return groupArtists(tracks).find((a) => a.artist === artist) ?? null;
}

/** "2024 · 9 tracks · 42 min" — only the parts we actually know. */
export function albumMeta(group: AlbumGroup): string {
  const parts: string[] = [`${group.tracks.length} ${group.tracks.length === 1 ? "track" : "tracks"}`];
  if (group.runtime > 0) {
    const mins = Math.round(group.runtime / 60);
    parts.push(`${mins} min`);
  }
  return parts.join(" · ");
}
