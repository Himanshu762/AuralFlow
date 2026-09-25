/**
 * Shared formatting helpers and quality-badge mapping.
 *
 * Badge colors come from the Stitch design system tokens:
 * hi-res #a855f7, lossless #10b981, dolby-atmos #3b82f6.
 */

import type { Track, StreamInfo } from "../stores/playerStore";

export function fmtTime(s?: number): string {
  if (!s || !isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export interface QualityBadge {
  /** Compact label for dense rows ("Hi-Res") */
  label: string;
  /** Expanded label for hero surfaces ("Hi-Res Lossless") */
  longLabel: string;
  /** Technical spec shown in the audio-engine rail */
  spec: string;
  /** Tailwind classes: background / text / ring */
  cls: string;
  /** Raw hex, for inline glows and canvas work */
  hex: string;
}

/** Format a real sample rate / bit depth pair, e.g. "24-bit / 96 kHz". */
export function formatSpec(info: StreamInfo | null | undefined): string | null {
  if (!info) return null;
  const parts: string[] = [];
  if (info.bitDepth) parts.push(`${info.bitDepth}-bit`);
  if (info.sampleRate) parts.push(`${(info.sampleRate / 1000).toFixed(info.sampleRate % 1000 === 0 ? 0 : 1)} kHz`);
  return parts.length > 0 ? parts.join(" / ") : null;
}

/**
 * Quality badge for a track.
 *
 * `spec` is the tier's nominal specification. Once the engine resolves a
 * stream, pass its StreamInfo to replace that with the real figures.
 */
export function qualityBadge(track: Track, info?: StreamInfo | null): QualityBadge | null {
  const badge = qualityTier(track);
  if (!badge) return null;
  const real = formatSpec(info);
  return real ? { ...badge, spec: real } : badge;
}

function qualityTier(track: Track): QualityBadge | null {
  if (track.audioQuality === "HI_RES_LOSSLESS")
    return {
      label: "Hi-Res",
      longLabel: "Hi-Res Lossless",
      spec: "Hi-Res",
      cls: "bg-hi-res/10 text-hi-res ring-1 ring-hi-res/40",
      hex: "#a855f7",
    };
  if (track.audioQuality === "LOSSLESS")
    return {
      label: "Lossless",
      longLabel: "FLAC Lossless",
      spec: "Lossless",
      cls: "bg-lossless/10 text-lossless ring-1 ring-lossless/40",
      hex: "#10b981",
    };
  if (track.audioModes?.includes("DOLBY_ATMOS"))
    return {
      label: "Atmos",
      longLabel: "Dolby Atmos",
      spec: "Spatial",
      cls: "bg-dolby-atmos/10 text-dolby-atmos ring-1 ring-dolby-atmos/40",
      hex: "#3b82f6",
    };
  return null;
}

/**
 * Codec actually in use, as reported by the engine.
 *
 * Returns null before a stream resolves — callers render a placeholder dash
 * rather than guessing from the track's advertised tier.
 */
export function streamCodec(info: StreamInfo | null | undefined): string | null {
  if (!info?.codec) return null;
  const codec = info.codec.toLowerCase();
  if (codec.includes("flac")) return "FLAC";
  if (codec.includes("alac")) return "ALAC";
  if (codec.includes("eac3") || codec.includes("ac-4") || codec.includes("ac4")) return "Dolby";
  if (codec.includes("mp4a") || codec.includes("aac")) return "AAC";
  return info.codec.toUpperCase();
}

/**
 * Uncompressed PCM rate implied by the real bit depth and sample rate.
 *
 * Labelled as PCM, not as the delivered bitrate: lossless codecs compress, so
 * the wire rate is lower and the engine does not report it.
 */
export function pcmRate(info: StreamInfo | null | undefined): string | null {
  if (!info?.bitDepth || !info?.sampleRate) return null;
  const kbps = Math.round((info.bitDepth * info.sampleRate * 2) / 1000);
  return `${kbps.toLocaleString()} kbps PCM`;
}

export const MOOD_DIMENSIONS = [
  "Energy",
  "Valence",
  "Dance",
  "Acoustic",
  "Instrumental",
] as const;

export const MOOD_EMOJI: Record<string, string> = {
  "Energetic & Uplifting": "⚡",
  "Intense & Dark": "🔥",
  "Calm & Peaceful": "🌊",
  "Melancholic & Introspective": "🌙",
  "Danceable & Rhythmic": "💃",
  "Acoustic & Organic": "🎸",
  "Instrumental & Ambient": "🎹",
  Balanced: "🎵",
};

/**
 * Put tracks in the order the agent ranked them.
 *
 * The agent scores every candidate by Q-value, including ones whose mood it
 * could not read, so its ordering is the useful one — sorting by the match
 * percentage instead would drop every unscored track to the bottom. Anything
 * the agent did not rank keeps its original position at the end.
 */
export function rankTracks<T extends { id: string }>(tracks: T[], ranking: string[]): T[] {
  if (ranking.length === 0) return tracks;

  const rank = new Map(ranking.map((id, i) => [id, i]));
  return [...tracks].sort(
    (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)
  );
}
