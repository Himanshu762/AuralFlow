"use client";

import React from "react";
import { motion } from "framer-motion";
import { Play, X, Sparkles, Compass, Loader2, ListPlus } from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";
import { qualityBadge, fmtTime } from "../lib/format";
import type { FlowMode } from "../lib/api";
import { MOOD_DIMENSIONS } from "../lib/format";

/**
 * The DJ, made visible.
 *
 * Pick an arc, and the card shows what the DJ has chosen to play next, why,
 * and where that reading came from. "Not this one" is a real signal — the
 * agent learns from it — and a fresh pick replaces it.
 */

export const FLOW_MODES: { id: FlowMode; label: string; hint: string }[] = [
  { id: "hold", label: "Hold", hint: "Keep the mood where it is" },
  { id: "drift", label: "Drift", hint: "Follow where the last few tracks were heading" },
  { id: "lift", label: "Lift", hint: "Raise energy and brightness, a step a track" },
  { id: "settle", label: "Settle", hint: "Wind down toward acoustic, instrumental material" },
  { id: "focus", label: "Focus", hint: "Mid-energy and instrumental, and stay there" },
  { id: "custom", label: "Custom", hint: "Head toward a mood you set" },
];

interface Props {
  compact: boolean;
  onPlayPick: () => void;
  onReject: () => void;
  onRefresh: () => void;
  onQueuePick?: () => void;
  /** Smaller layout for the sidebar / rail. */
  dense?: boolean;
}

export function FlowModeChips({ dense = false }: { dense?: boolean }) {
  const mode = usePlayerStore((s) => s.settings.flowMode);
  const setSetting = usePlayerStore((s) => s.setSetting);
  return (
    <div className={`flex flex-wrap ${dense ? "gap-1" : "gap-1.5"}`} role="radiogroup" aria-label="Session arc">
      {FLOW_MODES.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={m.hint}
            onClick={() => setSetting("flowMode", m.id)}
            className={`${dense ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-[12px]"} rounded-full font-semibold transition-colors ${
              active
                ? "bg-primary text-on-primary"
                : "bg-surface-high text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export function CustomTargetSliders() {
  const target = usePlayerStore((s) => s.settings.flowTarget);
  const horizon = usePlayerStore((s) => s.settings.flowHorizon);
  const setSetting = usePlayerStore((s) => s.setSetting);
  return (
    <div className="flex flex-col gap-2.5">
      {MOOD_DIMENSIONS.map((dim, i) => (
        <div key={dim} className="flex items-center gap-3">
          <span className="text-[11px] text-on-surface-variant w-20 flex-shrink-0">{dim}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={target[i] ?? 0.5}
            aria-label={`Target ${dim}`}
            onChange={(e) => {
              const next = [...target];
              next[i] = Number(e.target.value);
              setSetting("flowTarget", next);
            }}
            className="eq-slider-h flex-1"
          />
          <span className="text-[11px] text-outline font-mono w-8 text-right">{(target[i] ?? 0.5).toFixed(2)}</span>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-on-surface-variant w-20 flex-shrink-0">Over</span>
        <input
          type="range"
          min={2}
          max={12}
          step={1}
          value={horizon}
          aria-label="Tracks to arrive"
          onChange={(e) => setSetting("flowHorizon", Number(e.target.value))}
          className="eq-slider-h flex-1"
        />
        <span className="text-[11px] text-outline font-mono w-8 text-right">{horizon} tr</span>
      </div>
    </div>
  );
}

export default function FlowCard({ compact, onPlayPick, onReject, onRefresh, onQueuePick, dense = false }: Props) {
  const dj = usePlayerStore((s) => s.dj);
  const settings = usePlayerStore((s) => s.settings);
  const setSetting = usePlayerStore((s) => s.setSetting);
  const aiOnline = usePlayerStore((s) => s.aiStats.online);
  const track = usePlayerStore((s) => s.track);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);

  const pick = dj.pick;
  const badge = pick ? qualityBadge(pick) : null;
  const isQueued = pick ? queue.some((t, i) => i > queueIndex && t.id === pick.id) : false;
  const mode = FLOW_MODES.find((m) => m.id === settings.flowMode) ?? FLOW_MODES[1];

  const provenance =
    pick?.mood_source === "measured"
      ? { text: "Measured", cls: "bg-lossless/10 text-lossless ring-1 ring-lossless/40" }
      : pick?.mood_source === "artist"
        ? { text: "Artist prior", cls: "bg-hi-res/10 text-hi-res ring-1 ring-hi-res/40" }
        : pick?.mood_source === "genre"
          ? { text: "Genre", cls: "bg-surface-high text-outline ring-1 ring-white/10" }
          : { text: "Unread", cls: "bg-surface-high text-outline ring-1 ring-white/10" };

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-surface-low ring-1 ring-white/8 ${dense ? "p-3.5" : compact ? "p-4" : "p-5"}`}>
      {!dense && (
        <>
          <div className="ambient-glow -right-16 -top-16 w-72 h-72 bg-primary-container/10" />
          <div className="ambient-glow -left-8 -bottom-10 w-56 h-56 bg-hi-res/10" />
        </>
      )}

      <div className="relative z-10 flex items-center gap-2 mb-3 flex-wrap">
        <Compass className="w-4 h-4 text-primary" />
        <span className="text-label-sm uppercase tracking-[0.12em] text-on-surface font-bold">Flow</span>
        <span className="text-[11px] text-outline truncate">{mode.hint}</span>
        {!aiOnline && (
          <span className="ml-auto px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-surface-high text-outline">
            DJ offline
          </span>
        )}
      </div>

      <div className="relative z-10 mb-4">
        <FlowModeChips dense={dense} />
        {settings.flowMode === "custom" && !dense && (
          <div className="mt-3 pt-3 border-t border-white/8">
            <CustomTargetSliders />
          </div>
        )}
      </div>

      {/* ---- The pick ---- */}
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <span className="section-eyebrow">Next up</span>
          <div className="flex items-center gap-2">
            {dj.exploring && pick && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-tertiary-container/15 text-tertiary-container ring-1 ring-tertiary-container/40">
                <Sparkles className="w-3 h-3" /> Discovery
              </span>
            )}
            {dj.deciding && <Loader2 className="w-3.5 h-3.5 text-outline animate-spin" />}
          </div>
        </div>

        {pick ? (
          <motion.div
            key={pick.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${dense ? "gap-2.5" : "gap-4"} items-start`}
          >
            <button
              type="button"
              onClick={onPlayPick}
              aria-label={`Play ${pick.title} now`}
              className={`relative group rounded-xl overflow-hidden flex-shrink-0 ring-1 ring-white/10 shadow-xl ${
                dense ? "w-14 h-14" : compact ? "w-20 h-20" : "w-24 h-24"
              }`}
            >
              {pick.cover ? (
                <img src={pick.coverLarge || pick.cover} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-surface-high" />
              )}
              <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Play className="w-6 h-6 text-white fill-current" />
              </span>
            </button>

            <div className="flex-1 min-w-0">
              <p className={`${dense ? "text-[13px]" : "text-[16px]"} font-semibold text-on-surface truncate`}>{pick.title}</p>
              <p className="text-[12px] text-on-surface-variant truncate">{pick.artist}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${provenance.cls}`}>
                  {provenance.text}
                </span>
                {typeof pick.fit === "number" && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary-container/15 text-primary ring-1 ring-primary-container/40">
                    {Math.round(pick.fit * 100)}% fit
                  </span>
                )}
                {badge && (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${badge.cls}`}>
                    {badge.label}
                  </span>
                )}
                {pick.measured?.tempo_bpm && (
                  <span className="text-[10px] text-outline font-mono">{pick.measured.tempo_bpm} BPM</span>
                )}
                <span className="text-[10px] text-outline font-mono ml-auto">{fmtTime(pick.duration)}</span>
              </div>
              {!dense && <p className="text-[11px] text-outline leading-relaxed mt-2">{dj.reason}</p>}

              <div className={`flex items-center gap-2 ${dense ? "mt-2" : "mt-3"}`}>
                <button
                  type="button"
                  onClick={onPlayPick}
                  className={`${dense ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-[12px]"} rounded-full bg-white text-black font-semibold active:scale-95 transition-transform flex items-center gap-1.5`}
                >
                  <Play className="w-3.5 h-3.5 fill-current" /> Play now
                </button>
                {onQueuePick && !isQueued && (
                  <button
                    type="button"
                    onClick={onQueuePick}
                    className={`${dense ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-[12px]"} rounded-full bg-surface-high text-on-surface-variant hover:text-on-surface font-semibold flex items-center gap-1.5`}
                  >
                    <ListPlus className="w-3.5 h-3.5" /> Queue
                  </button>
                )}
                {isQueued && <span className="text-[11px] text-lossless font-semibold">Queued next</span>}
                <button
                  type="button"
                  onClick={onReject}
                  className={`${dense ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-[12px]"} rounded-full bg-surface-high text-on-surface-variant hover:text-danger font-semibold flex items-center gap-1.5 ml-auto`}
                >
                  <X className="w-3.5 h-3.5" /> Not this
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="flex items-center gap-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-on-surface-variant">
                {dj.deciding
                  ? "Choosing…"
                  : !aiOnline
                    ? "The recommendation backend is not reachable."
                    : !track
                      ? "Play something and the DJ will line up what follows."
                      : dj.reason || "Nothing to choose from yet — the library fills as you play and search."}
              </p>
              {dj.library && (
                <p className="text-[11px] text-outline mt-1">
                  Library: {dj.library.tracks} tracks · {dj.library.measured} measured · {dj.library.artists} artists
                </p>
              )}
            </div>
            {track && aiOnline && !dj.deciding && (
              <button
                type="button"
                onClick={onRefresh}
                className="px-3 py-1.5 rounded-full bg-surface-high text-[12px] font-semibold text-on-surface-variant hover:text-on-surface flex-shrink-0"
              >
                Ask again
              </button>
            )}
          </div>
        )}
      </div>

      {!dense && (
        <div className="relative z-10 mt-4 pt-3 border-t border-white/8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoQueue}
              onChange={(e) => setSetting("autoQueue", e.target.checked)}
              className="accent-[var(--color-primary-container)]"
            />
            <span className="text-on-surface-variant">Queue the pick automatically</span>
          </label>
          {dj.poolSize > 0 && <span className="text-outline">Pool {dj.poolSize}</span>}
          {dj.policyWeight > 0 && (
            <span className="text-outline" title="How much of the decision the learned policy carries; the rest is fit to the arc">
              Policy {Math.round(dj.policyWeight * 100)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
