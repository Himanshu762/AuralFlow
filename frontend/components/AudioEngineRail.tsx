"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GripVertical, Sparkles, Radio, X, AudioLines } from "lucide-react";
import { usePlayerStore, type RailTab, type Track } from "../stores/playerStore";
import { fmtTime, qualityBadge, streamCodec, pcmRate, formatSpec, MOOD_DIMENSIONS, rankTracks } from "../lib/format";

const BANDS = ["32", "64", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"] as const;

interface Props {
  onPlay: (track: Track) => void;
}

/**
 * Right-hand inspector, adapted from the Stitch desktop workstation sidecar.
 *
 * The spectrum is real: the Monochrome bridge samples the engine's shared
 * AnalyserNode and posts ten normalised band levels to the shell.
 */
export default function AudioEngineRail({ onPlay }: Props) {
  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const railTab = usePlayerStore((s) => s.railTab);
  const setRailTab = usePlayerStore((s) => s.setRailTab);
  const setRailOpen = usePlayerStore((s) => s.setRailOpen);
  const searchResults = usePlayerStore((s) => s.searchResults);
  const currentMood = usePlayerStore((s) => s.currentMood);
  const aiScores = usePlayerStore((s) => s.aiScores);
  const aiRanking = usePlayerStore((s) => s.aiRanking);
  const settings = usePlayerStore((s) => s.settings);
  const setSetting = usePlayerStore((s) => s.setSetting);
  const streamInfo = usePlayerStore((s) => s.streamInfo);
  const spectrum = usePlayerStore((s) => s.spectrum);

  const badge = track ? qualityBadge(track, streamInfo) : null;

  const currentIdx = track ? searchResults.findIndex((t) => t.id === track.id) : -1;
  const upNext = (currentIdx >= 0 ? searchResults.slice(currentIdx + 1) : searchResults).slice(0, 8);

  const tabs: { id: RailTab; label: string; dot?: boolean }[] = [
    { id: "engine", label: "Engine" },
    { id: "queue", label: "Queue", dot: upNext.length > 0 },
    { id: "lyrics", label: "Insights" },
  ];

  return (
    <aside className="w-[var(--spacing-rail)] flex-shrink-0 border-l border-white/6 bg-surface-lowest/70 backdrop-blur-2xl flex flex-col overflow-hidden">
      {/* Header + tab pills */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <AudioLines className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="text-label-sm uppercase tracking-wider text-on-surface font-bold truncate">
            Audio Engine
          </span>
        </div>
        <button
          type="button"
          onClick={() => setRailOpen(false)}
          aria-label="Hide audio engine panel"
          className="text-outline hover:text-on-surface transition-colors active:scale-95"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 pb-3 flex items-center gap-1 flex-shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setRailTab(t.id)}
            className={`relative px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
              railTab === t.id
                ? "bg-surface-high text-on-surface"
                : "text-outline hover:text-on-surface"
            }`}
          >
            {t.label}
            {t.dot && railTab !== t.id && (
              <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-primary-container" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto hide-scrollbar px-4 pb-5 space-y-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={railTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            {railTab === "engine" && (
              <>
                <HoloDisc />
                <TelemetryCard />
                <SpectrumWidget levels={spectrum} active={playing} />
                <div className="rounded-xl bg-surface-container p-4 flex items-center gap-3">
                  <Radio className="w-5 h-5 text-primary flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-label-md font-semibold text-on-surface">Head-Tracking HRTF</div>
                    <div className="text-[11px] text-outline truncate">Real-time gyro motion matrix</div>
                  </div>
                  <Toggle
                    checked={settings.headTracking}
                    onChange={(v) => setSetting("headTracking", v)}
                    label="Head-tracking HRTF"
                  />
                </div>
              </>
            )}

            {railTab === "queue" && (
              <>
                {track && (
                  <div className="rounded-xl bg-surface-container p-3">
                    <div className="section-eyebrow mb-2">Now Playing</div>
                    <div className="flex items-center gap-2.5">
                      <img
                        src={track.cover}
                        alt=""
                        className="w-10 h-10 rounded object-cover flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-on-surface truncate">{track.title}</div>
                        <div className="text-[11px] text-outline truncate">{track.artist}</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between px-1">
                  <span className="section-eyebrow">Next in Queue</span>
                  <span className="text-[11px] text-outline">{upNext.length}</span>
                </div>

                {upNext.length === 0 ? (
                  <p className="text-[12px] text-outline px-1 py-4">
                    Nothing queued. Play a track to build the flow.
                  </p>
                ) : (
                  upNext.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onPlay(t)}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-surface-container hover:bg-surface-high transition-colors group text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <GripVertical className="w-4 h-4 text-outline group-hover:text-on-surface flex-shrink-0" />
                        <img src={t.cover} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold text-on-surface truncate">{t.title}</div>
                          <div className="text-[11px] text-outline truncate">{t.artist}</div>
                        </div>
                      </div>
                      <span className="text-label-sm text-outline font-mono flex-shrink-0 ml-2">
                        {fmtTime(t.duration)}
                      </span>
                    </button>
                  ))
                )}
              </>
            )}

            {railTab === "lyrics" && (
              <>
                <div className="rounded-xl bg-surface-container p-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-label-sm uppercase tracking-wider text-on-surface font-bold">
                      Mood Vector
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {MOOD_DIMENSIONS.map((dim, i) => (
                      <div key={dim}>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-on-surface-variant">{dim}</span>
                          <span className="text-outline font-mono">
                            {(currentMood[i] ?? 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-surface-high overflow-hidden">
                          <div
                            className="h-full bg-primary-container transition-all duration-700 ease-out"
                            style={{ width: `${Math.max(2, Math.min(100, (currentMood[i] ?? 0) * 100))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {track?.mood_label && (
                    <div className="mt-3.5 pt-3 border-t border-white/8 text-[12px] text-on-surface-variant">
                      Reading this track as{" "}
                      <span className="text-primary font-semibold">{track.mood_label}</span>
                    </div>
                  )}
                </div>

                <div className="rounded-xl bg-surface-container p-4">
                  <div className="section-eyebrow mb-3">AI DJ Confidence</div>
                  {searchResults.length === 0 ? (
                    <p className="text-[12px] text-outline">No candidates scored yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {rankTracks(searchResults, aiRanking)
                        .slice(0, 5)
                        .map((t) => {
                          /* Undefined when the track carried no genre to read
                             a mood from. The agent still ranked it, so it
                             keeps its place in the list — there is just no
                             affinity to draw. */
                          const score = aiScores.get(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => onPlay(t)}
                              className="w-full text-left group"
                            >
                              <div className="flex items-center justify-between text-[11px] mb-1">
                                <span className="text-on-surface-variant truncate pr-2 group-hover:text-on-surface">
                                  {t.title}
                                </span>
                                <span
                                  className={`font-mono flex-shrink-0 ${score === undefined ? "text-outline" : "text-primary"}`}
                                  title={score === undefined ? "No genre to read a mood from" : undefined}
                                >
                                  {score === undefined ? "—" : `${Math.round(score * 100)}%`}
                                </span>
                              </div>
                              <div className="h-1 rounded-full bg-surface-high overflow-hidden">
                                {score !== undefined && (
                                  <div
                                    className="h-full bg-primary rounded-full transition-all duration-500"
                                    style={{ width: `${Math.max(2, Math.min(100, score * 100))}%` }}
                                  />
                                )}
                              </div>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </aside>
  );

  /* ---------------- Sub-widgets ---------------- */

  function HoloDisc() {
    return (
      <div className="flex flex-col items-center py-2">
        <div className="relative w-40 h-40 flex items-center justify-center">
          {/* Ripple glow rings */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `radial-gradient(circle, ${badge?.hex ?? "#3e90ff"}22 0%, transparent 65%)`,
            }}
          />
          <div
            className={`absolute w-36 h-36 rounded-full bg-surface-high ${playing ? "animate-spin-slow" : ""}`}
            style={{
              backgroundImage:
                "repeating-conic-gradient(rgba(255,255,255,0.045) 0deg 2deg, transparent 2deg 4deg)",
            }}
          >
            {track && (
              <img
                src={track.coverLarge || track.cover}
                alt=""
                className="absolute inset-0 m-auto w-16 h-16 rounded-full object-cover ring-2 ring-black/60"
              />
            )}
            <span className="absolute inset-0 m-auto w-2.5 h-2.5 rounded-full bg-surface-lowest ring-1 ring-white/10" />
          </div>
        </div>
        <div className="text-center mt-3 px-2 w-full">
          <div className="text-label-md font-semibold text-on-surface truncate">
            {track?.title ?? "No signal"}
          </div>
          <div className="text-[11px] text-outline truncate mt-0.5">
            {track ? `${track.artist} · Direct stream` : "Awaiting playback"}
          </div>
        </div>
      </div>
    );
  }

  function TelemetryCard() {
    const cells = [
      { label: "Encoding Codec", value: streamCodec(streamInfo) ?? "—", tone: "text-on-surface" },
      { label: "Sample Rate", value: formatSpec(streamInfo) ?? "—", tone: "text-hi-res" },
      { label: "PCM Rate", value: pcmRate(streamInfo) ?? "—", tone: "text-on-surface" },
      { label: "Duration", value: fmtTime(track?.duration), tone: "text-lossless" },
    ];
    return (
      <div className="rounded-xl bg-surface-container p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="section-eyebrow">Bitstream Telemetry</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`w-2 h-2 rounded-full ${playing ? "bg-lossless animate-pulse" : "bg-outline/50"}`} />
            <span className={`text-label-sm font-semibold ${playing ? "text-lossless" : "text-outline"}`}>
              {playing ? "Streaming" : "Idle"}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {cells.map((c) => (
            <div key={c.label} className="p-2 rounded-lg bg-surface-low">
              <div className="text-[10px] text-outline uppercase tracking-wide">{c.label}</div>
              <div className={`text-[13px] font-semibold font-mono mt-0.5 truncate ${c.tone}`}>{c.value}</div>
            </div>
          ))}
        </div>
        <div className="pt-1 flex items-center justify-between text-[11px] gap-2">
          <span className="text-outline flex-shrink-0">Source:</span>
          <span className="text-on-surface font-semibold flex items-center gap-1.5 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary-container flex-shrink-0" />
            {streamInfo?.provider ?? "—"}
          </span>
        </div>
      </div>
    );
  }
}

/* ------------------------------------------------------------------ */
/* Spectrum visualiser                                                */
/* ------------------------------------------------------------------ */

function SpectrumWidget({ levels, active }: { levels: number[]; active: boolean }) {
  return (
    <div className="rounded-xl bg-surface-container p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="section-eyebrow">10-Band Spectrum</span>
        <span className="text-[10px] font-mono text-outline flex-shrink-0">
          {active ? "Live FFT" : "Silent"}
        </span>
      </div>
      <div className="h-24 w-full flex items-end justify-between gap-1.5">
        {BANDS.map((band, i) => {
          const isAir = i === BANDS.length - 1;
          const level = levels[i] ?? 0;
          return (
            <div key={band} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
              <div className="w-full flex-1 flex items-end rounded-t bg-surface-high overflow-hidden">
                <div
                  className={`w-full rounded-t transition-[height] duration-75 ease-out ${
                    isAir ? "bg-hi-res" : "bg-primary-container"
                  }`}
                  style={{ height: `${Math.max(2, Math.min(100, level * 100))}%` }}
                />
              </div>
              <span className={`text-[9px] ${isAir ? "text-hi-res font-bold" : "text-outline"}`}>{band}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tactile toggle (Stitch settings switch)                            */
/* ------------------------------------------------------------------ */

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-200 ${
        checked ? "bg-primary-container" : "bg-surface-highest"
      }`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md"
        style={{ left: checked ? "calc(100% - 22px)" : "2px" }}
      />
    </button>
  );
}
