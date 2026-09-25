"use client";

import React, { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Gauge, RotateCcw, Headphones, Search, Check } from "lucide-react";
import { usePlayerStore, type PlayerState } from "../stores/playerStore";

type AutoEqHeadphone = PlayerState["autoEq"]["headphones"][number];

/**
 * The equaliser, and the adaptive layer that drives it.
 *
 * Two ways to use it. Set the bands by hand, or leave the stabiliser on and
 * let it hold the balance steady for you — it learns the balance of what the
 * listener normally plays and pulls outliers toward it, which is what stops a
 * dull master and a bright one from jumping at each other on shuffle.
 * Touching a band by hand takes the stabiliser off, since both drive the same
 * filters.
 */

interface Props {
  onGetState: () => void;
  onGetPresets: () => void;
  onSearchHeadphones: (query?: string) => void;
  onApplyAutoEq: (headphone: AutoEqHeadphone, target: string) => void;
  onSetEnabled: (enabled: boolean) => void;
  onSetGains: (gains: number[]) => void;
  onSetPreamp: (db: number) => void;
  onSetAdaptive: (opts: { enabled: boolean; tilt?: number; strength?: number }) => void;
  compact: boolean;
}

/** Bands run from 25 Hz to 20 kHz; label them the way a mixer would. */
function label(hz: number): string {
  return hz >= 1000 ? `${Math.round(hz / 100) / 10}k` : `${Math.round(hz)}`;
}

const RANGE = 12; /* dB shown above and below centre */

export default function Equalizer({
  onGetState,
  onGetPresets,
  onSearchHeadphones,
  onApplyAutoEq,
  onSetEnabled,
  onSetGains,
  onSetPreamp,
  onSetAdaptive,
  compact,
}: Props) {
  const eq = usePlayerStore((s) => s.eq);
  const monoReady = usePlayerStore((s) => s.monoReady);

  /* Ask the engine for its state once it is up, and again whenever the
     adaptive layer is running so the drawn correction stays live. */
  const askedRef = useRef(false);
  useEffect(() => {
    if (!monoReady || askedRef.current) return;
    askedRef.current = true;
    onGetState();
    onGetPresets();
  }, [monoReady, onGetState, onGetPresets]);

  useEffect(() => {
    if (!eq.adaptive.on) return;
    const id = setInterval(onGetState, 1000);
    return () => clearInterval(id);
  }, [eq.adaptive.on, onGetState]);

  const presets = usePlayerStore((s) => s.eqPresets);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("");
  const autoEq = usePlayerStore((s) => s.autoEq);
  const bands = eq.frequencies.length;
  const curve = eq.adaptive.curve;

  const setBand = (i: number, value: number) => {
    const next = [...eq.gains];
    next[i] = value;
    onSetGains(next);
  };

  if (!monoReady) {
    return (
      <div className="rounded-2xl bg-surface-container p-6 text-center">
        <p className="text-[13px] text-outline">Waiting for the audio engine…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------- Adaptive stabiliser ---------------- */}
      <div className="rounded-2xl bg-surface-container p-5">
        <div className="flex items-start gap-3.5 mb-4">
          <span className="w-10 h-10 rounded-xl bg-primary-container/15 ring-1 ring-primary-container/30 flex items-center justify-center text-primary flex-shrink-0">
            <Gauge className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-on-surface">Adaptive Stabiliser</p>
            <p className="text-[12px] text-outline leading-snug">
              Learns the balance of what you normally play, then nudges records
              that sit outside it back into line — so a dull master and a bright
              one stop jumping at each other on shuffle.
            </p>
          </div>
          <Toggle
            checked={eq.adaptive.on}
            onChange={(v) => onSetAdaptive({ enabled: v })}
            label="Adaptive stabiliser"
          />
        </div>

        {eq.adaptive.on && (
          <div className="flex flex-col gap-3.5 pt-3.5 border-t border-white/8">
            <Slider
              label="Strength"
              hint={`${Math.round(eq.adaptive.strength * 100)}%`}
              value={eq.adaptive.strength}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => onSetAdaptive({ enabled: true, strength: v })}
            />
            <Slider
              label="Tilt"
              hint={
                eq.adaptive.tilt === 0
                  ? "Neutral"
                  : eq.adaptive.tilt < 0
                    ? `Warmer ${eq.adaptive.tilt.toFixed(1)} dB`
                    : `Brighter +${eq.adaptive.tilt.toFixed(1)} dB`
              }
              value={eq.adaptive.tilt}
              min={-6}
              max={6}
              step={0.5}
              onChange={(v) => onSetAdaptive({ enabled: true, tilt: v })}
            />
            <p className="text-[11px] text-outline leading-relaxed">
              A record already in line with your library is left untouched. The
              measurement runs over several seconds so it follows the record
              rather than the beat, and it is re-centred each time, so it
              re-balances instead of turning everything up.
            </p>
          </div>
        )}
      </div>

      {/* ---------------- Headphone correction ---------------- */}
      <div className="rounded-2xl bg-surface-container p-5">
        <div className="flex items-start gap-3.5 mb-4">
          <span className="w-10 h-10 rounded-xl bg-primary-container/15 ring-1 ring-primary-container/30 flex items-center justify-center text-primary flex-shrink-0">
            <Headphones className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-on-surface">Headphone Correction</p>
            <p className="text-[12px] text-outline leading-snug">
              Measured responses from the AutoEQ database, turned into a curve that
              flattens your headphones toward a reference target.
            </p>
          </div>
        </div>

        {autoEq.applied && (
          <div className="flex items-center gap-2 mb-3.5 text-[12px] text-lossless">
            <Check className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">
              {autoEq.applied}
              {autoEq.message && <span className="text-outline"> · {autoEq.message}</span>}
            </span>
          </div>
        )}
        {!autoEq.applied && autoEq.message && (
          <p className="text-[12px] text-danger mb-3.5">{autoEq.message}</p>
        )}

        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-xl bg-surface-high">
            <Search className="w-3.5 h-3.5 text-outline flex-shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSearchHeadphones(query.trim());
              }}
              placeholder="Search headphones — e.g. HD 600"
              aria-label="Search headphones"
              className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-on-surface placeholder-outline"
            />
          </div>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Target curve"
            className="px-2.5 py-2 rounded-xl bg-surface-high text-[12px] text-on-surface outline-none flex-shrink-0 max-w-[40%]"
          >
            {autoEq.targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {autoEq.searching ? (
          <p className="text-[12px] text-outline">Searching…</p>
        ) : autoEq.headphones.length === 0 ? (
          <p className="text-[12px] text-outline">
            No headphones loaded yet — search above, or press Enter for popular ones.
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto scroll-area rounded-xl bg-surface-high/50 divide-y divide-white/5">
            {autoEq.headphones.map((h) => (
              <button
                key={`${h.path}/${h.fileName}`}
                type="button"
                onClick={() => onApplyAutoEq(h, target || autoEq.targets[0]?.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-container transition-colors"
              >
                <span className="text-[12px] text-on-surface-variant truncate flex-1">{h.name}</span>
                {h.type && (
                  <span className="text-[10px] text-outline uppercase tracking-wider flex-shrink-0">
                    {h.type}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <p className="text-[11px] text-outline mt-3 leading-relaxed">
          A correction is fixed for your hardware, so applying one switches the
          adaptive stabiliser off — both drive the same filters.
        </p>
      </div>

      {/* ---------------- Bands ---------------- */}
      <div className="rounded-2xl bg-surface-container p-5">
        <div className="flex items-center gap-3.5 mb-5">
          <span className="w-10 h-10 rounded-xl bg-primary-container/15 ring-1 ring-primary-container/30 flex items-center justify-center text-primary flex-shrink-0">
            <SlidersHorizontal className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-on-surface">Equaliser</p>
            <p className="text-[12px] text-outline">
              {bands} bands
              {eq.adaptive.on && " · the stabiliser is driving these"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSetGains(new Array(bands).fill(0))}
            disabled={bands === 0}
            aria-label="Reset all bands"
            className="w-9 h-9 rounded-full flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-high transition-colors disabled:opacity-30"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <Toggle
            checked={eq.enabled}
            onChange={onSetEnabled}
            label="Equaliser"
          />
        </div>

        {presets.length > 0 && bands > 0 && (
          <div className="flex gap-1.5 overflow-x-auto scroll-area pb-2 mb-4 -mx-1 px-1">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSetGains(p.gains)}
                disabled={eq.adaptive.on}
                className="px-3 py-1.5 rounded-full bg-surface-high text-[11px] font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors flex-shrink-0 disabled:opacity-40"
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {bands === 0 ? (
          <p className="text-[12px] text-outline">
            The equaliser comes up with the audio graph — play something to set it.
          </p>
        ) : (
          <div
            className={`flex items-end gap-1.5 overflow-x-auto scroll-area pb-1 ${
              compact ? "" : "justify-between"
            }`}
          >
            {eq.frequencies.map((hz, i) => {
              const manual = eq.gains[i] ?? 0;
              const auto = curve?.[i] ?? 0;
              /* When the stabiliser runs it is what you actually hear, so
                 show that and keep the hand-set value behind it. */
              const shown = eq.adaptive.on ? auto : manual;
              return (
                <div key={hz} className="flex flex-col items-center gap-1.5 flex-1 min-w-[26px]">
                  <span
                    className={`text-[9px] font-mono tabular-nums ${
                      Math.abs(shown) < 0.1 ? "text-outline/60" : "text-primary"
                    }`}
                  >
                    {shown > 0 ? "+" : ""}
                    {shown.toFixed(1)}
                  </span>

                  <input
                    type="range"
                    min={-RANGE}
                    max={RANGE}
                    step={0.5}
                    value={shown}
                    disabled={eq.adaptive.on}
                    onChange={(e) => setBand(i, Number(e.target.value))}
                    aria-label={`${label(hz)} hertz`}
                    className="eq-slider"
                    style={{ writingMode: "vertical-lr", direction: "rtl" }}
                  />

                  <span className="text-[9px] text-outline font-mono">{label(hz)}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-white/8">
          <Slider
            label="Preamp"
            hint={`${eq.preamp > 0 ? "+" : ""}${eq.preamp.toFixed(1)} dB`}
            value={eq.preamp}
            min={-12}
            max={12}
            step={0.5}
            onChange={onSetPreamp}
          />
          <p className="text-[11px] text-outline mt-2 leading-relaxed">
            Pull this down if boosted bands make the output clip.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small controls                                                      */
/* ------------------------------------------------------------------ */

function Toggle({
  checked,
  onChange,
  label: name,
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
      aria-label={name}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
        checked ? "bg-primary" : "bg-surface-high"
      }`}
    >
      <span
        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
        style={{ left: checked ? "calc(100% - 22px)" : "2px" }}
      />
    </button>
  );
}

function Slider({
  label: name,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] text-on-surface-variant font-medium">{name}</span>
        <span className="text-[11px] text-outline font-mono tabular-nums">{hint}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={name}
        className="eq-slider-h"
      />
    </div>
  );
}
