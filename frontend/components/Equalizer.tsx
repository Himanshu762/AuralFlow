"use client";

import React, { useEffect, useRef } from "react";
import { SlidersHorizontal, Gauge, RotateCcw } from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";

/**
 * The equaliser the listener sets by hand.
 *
 * It is the base layer of the Sound Signature: the device correction, the
 * track stabiliser and loudness compensation stack on top of it, and the
 * total the filters are actually running is shown against each band.
 */

interface Props {
  onGetState: () => void;
  onGetPresets: () => void;
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
  const composed = usePlayerStore((s) => s.signature?.composed ?? null);
  const bands = eq.frequencies.length;

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
      {/* ---------------- Stabiliser fine-tuning ---------------- */}
      {eq.adaptive.on && (
      <div className="rounded-2xl bg-surface-container p-5">
        <div className="flex items-start gap-3.5 mb-4">
          <span className="w-10 h-10 rounded-xl bg-primary-container/15 ring-1 ring-primary-container/30 flex items-center justify-center text-primary flex-shrink-0">
            <Gauge className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-on-surface">Track Stabiliser</p>
            <p className="text-[12px] text-outline leading-snug">
              How hard the stabiliser pulls a record toward the balance of what
              you normally play, and which way to lean it.
            </p>
          </div>
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
      )}

      {/* ---------------- Bands ---------------- */}
      <div className="rounded-2xl bg-surface-container p-5">
        <div className="flex items-center gap-3.5 mb-5">
          <span className="w-10 h-10 rounded-xl bg-primary-container/15 ring-1 ring-primary-container/30 flex items-center justify-center text-primary flex-shrink-0">
            <SlidersHorizontal className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-on-surface">Equaliser</p>
            <p className="text-[12px] text-outline">
              {bands} bands · your curve; the signature layers stack on top
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
              const total = composed?.[i];
              return (
                <div key={hz} className="flex flex-col items-center gap-1.5 flex-1 min-w-[26px]">
                  <span
                    className={`text-[9px] font-mono tabular-nums ${
                      Math.abs(manual) < 0.1 ? "text-outline/60" : "text-primary"
                    }`}
                    title={typeof total === "number" ? `Running total ${total > 0 ? "+" : ""}${total.toFixed(1)} dB` : undefined}
                  >
                    {manual > 0 ? "+" : ""}
                    {manual.toFixed(1)}
                  </span>

                  <input
                    type="range"
                    min={-RANGE}
                    max={RANGE}
                    step={0.5}
                    value={manual}
                    onChange={(e) => setBand(i, Number(e.target.value))}
                    aria-label={`${label(hz)} hertz`}
                    className="eq-slider"
                    style={{ writingMode: "vertical-lr", direction: "rtl" }}
                  />

                  <span className="text-[9px] text-outline font-mono">{label(hz)}</span>
                  {typeof total === "number" && Math.abs(total - manual) >= 0.1 && (
                    <span className="text-[8px] text-lossless font-mono tabular-nums" title="What the filters are running, all layers summed">
                      {total > 0 ? "+" : ""}
                      {total.toFixed(1)}
                    </span>
                  )}
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
