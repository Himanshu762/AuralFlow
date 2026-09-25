"use client";

import React from "react";
import { usePlayerStore } from "../stores/playerStore";
import { MOOD_DIMENSIONS } from "../lib/format";

/**
 * The five mood dimensions, with the arc's target drawn as a tick over each
 * bar so the listener can see where the DJ is steering.
 *
 * Nothing here is decorative: the bars are the current reading, the ticks
 * are the target the DJ was given, and the caption says where the reading
 * came from and how much audio it rests on.
 */

export function moodProvenance(reading: {
  source: string;
  confidence: number;
  seconds: number;
  live: boolean;
}): { label: string; tone: string; detail: string } {
  switch (reading.source) {
    case "measured":
      return {
        label: reading.live ? "Measuring" : "Measured",
        tone: "text-lossless",
        detail: `${Math.round(reading.seconds)} s of audio · ${Math.round(reading.confidence * 100)}% confidence`,
      };
    case "artist":
      return { label: "Artist prior", tone: "text-hi-res", detail: "From measured tracks by the same artist" };
    case "genre":
      return { label: "Genre tag", tone: "text-outline", detail: "Rough reading until the audio is measured" };
    default:
      return {
        label: reading.live ? "Measuring" : "Not read yet",
        tone: "text-outline",
        detail: reading.live ? `${Math.round(reading.seconds)} s analysed` : "Play it and the engine will listen",
      };
  }
}

interface Props {
  compact?: boolean;
  /** Draw bars vertically (sidebar) instead of as rows. */
  vertical?: boolean;
  /** One dimension per row, for narrow panels such as the inspector rail. */
  stacked?: boolean;
  showCaption?: boolean;
}

export default function MoodMeter({ compact = false, vertical = false, stacked = false, showCaption = true }: Props) {
  const currentMood = usePlayerStore((s) => s.currentMood);
  const target = usePlayerStore((s) => s.dj.target);
  const reading = usePlayerStore((s) => s.moodReading);
  const track = usePlayerStore((s) => s.track);
  const prov = moodProvenance(reading);

  if (vertical) {
    return (
      <div>
        <div className="flex items-end gap-1.5">
          {currentMood.map((v, i) => (
            <div key={MOOD_DIMENSIONS[i] ?? i} className="flex-1 flex flex-col items-center gap-1">
              <div className="relative w-full h-9 flex items-end rounded-sm bg-surface-high overflow-hidden">
                <div
                  className="w-full bg-primary-container/80 transition-all duration-700 ease-out"
                  style={{ height: `${Math.max(6, Math.min(100, v * 100))}%` }}
                />
                {target && (
                  <span
                    className="absolute left-0 right-0 h-px bg-white/70"
                    style={{ bottom: `${Math.max(0, Math.min(100, (target[i] ?? 0) * 100))}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
              <span className="text-[8px] text-outline uppercase tracking-wide">
                {(MOOD_DIMENSIONS[i] ?? "").slice(0, 3)}
              </span>
            </div>
          ))}
        </div>
        {showCaption && (
          <div className="mt-2 flex items-center justify-between text-[10px]">
            <span className={`font-semibold ${prov.tone}`}>{prov.label}</span>
            <span className="text-outline truncate ml-2">{track ? prov.detail : "Nothing playing"}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={`grid ${stacked ? "grid-cols-1 gap-2.5" : compact ? "grid-cols-2 gap-x-5 gap-y-3" : "grid-cols-5 gap-4"}`}>
        {MOOD_DIMENSIONS.map((dim, i) => (
          <div key={dim}>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[11px] text-on-surface-variant truncate">{dim}</span>
              <span className="text-[11px] text-outline font-mono">
                {(currentMood[i] ?? 0).toFixed(2)}
                {target && (
                  <span className="text-outline/60"> → {(target[i] ?? 0).toFixed(2)}</span>
                )}
              </span>
            </div>
            <div className="relative h-1.5 rounded-full bg-surface-high">
              <div
                className="absolute inset-y-0 left-0 bg-primary-container rounded-full transition-all duration-700 ease-out"
                style={{ width: `${Math.max(3, Math.min(100, (currentMood[i] ?? 0) * 100))}%` }}
              />
              {target && (
                <span
                  className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-white/80"
                  style={{ left: `${Math.max(0, Math.min(100, (target[i] ?? 0) * 100))}%` }}
                  aria-hidden="true"
                  title={`Target ${(target[i] ?? 0).toFixed(2)}`}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      {showCaption && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className={`font-semibold ${prov.tone}`}>{prov.label}</span>
          <span className="text-outline">{track ? prov.detail : "Nothing playing"}</span>
          {reading.measured?.tempo_bpm && (
            <span className="text-outline font-mono ml-auto">
              {reading.measured.tempo_bpm} BPM
              {reading.measured.mode ? ` · ${reading.measured.mode}` : ""}
              {reading.measured.loudness_db !== null ? ` · ${reading.measured.loudness_db} dBFS` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
