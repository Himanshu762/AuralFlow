"use client";

import React, { useEffect, useState } from "react";
import { Headphones, Speaker, Usb, Volume2, Layers, RefreshCw, X, Check, Search } from "lucide-react";
import { usePlayerStore, type PlayerState } from "../stores/playerStore";
import { Toggle } from "./AudioEngineRail";

type AutoEqHeadphone = PlayerState["autoEq"]["headphones"][number];

/**
 * The Sound Signature: one correction from three sources, shown as the
 * layers it is made of.
 *
 *   device    a correction for whatever is playing the sound, matched from
 *             the AutoEQ database by the output device's name and kept per
 *             device, so it comes back the moment that device does
 *   track     the adaptive stabiliser's correction for the record playing now
 *   loudness  equal-loudness compensation that grows as the volume comes down
 *
 * All three stack on top of the listener's own equaliser curve, and each
 * can be switched off on its own.
 */

interface Props {
  compact: boolean;
  onGetDevices: (requestLabels?: boolean) => void;
  onSetDevice: (id: string) => void;
  onSetSignature: (opts: {
    enabled?: boolean;
    loudness?: boolean;
    autoDevice?: boolean;
    deviceLabel?: string;
    headphone?: AutoEqHeadphone;
    target?: string;
    clearDevice?: boolean;
  }) => void;
  onSearchHeadphones: (query?: string) => void;
  onSetAdaptive: (opts: { enabled: boolean; tilt?: number; strength?: number }) => void;
}

function label(hz: number): string {
  return hz >= 1000 ? `${Math.round(hz / 100) / 10}k` : `${Math.round(hz)}`;
}

export default function SoundSignature({
  compact,
  onGetDevices,
  onSetDevice,
  onSetSignature,
  onSearchHeadphones,
  onSetAdaptive,
}: Props) {
  const monoReady = usePlayerStore((s) => s.monoReady);
  const devices = usePlayerStore((s) => s.devices);
  const signature = usePlayerStore((s) => s.signature);
  const eq = usePlayerStore((s) => s.eq);
  const autoEq = usePlayerStore((s) => s.autoEq);

  const [deviceName, setDeviceName] = useState("");
  const [query, setQuery] = useState("");
  const [pickingHeadphone, setPickingHeadphone] = useState(false);

  useEffect(() => {
    if (monoReady) onGetDevices(false);
  }, [monoReady, onGetDevices]);

  if (!monoReady) {
    return (
      <div className="rounded-2xl bg-surface-container p-6 text-center">
        <p className="text-[13px] text-outline">Waiting for the audio engine…</p>
      </div>
    );
  }

  const device = signature?.device;
  const DeviceIcon = device?.kind === "headphones" ? Headphones : device?.kind === "speakers" ? Speaker : Usb;
  const freqs = signature?.frequencies ?? [];
  const layers: { key: string; name: string; values: number[] | null; cls: string }[] = [
    { key: "manual", name: "Your EQ", values: signature?.manual ?? null, cls: "bg-on-surface/60" },
    { key: "device", name: "Device", values: device?.correction ?? null, cls: "bg-hi-res" },
    { key: "track", name: "Track", values: signature?.track ?? null, cls: "bg-primary-container" },
    { key: "loudness", name: "Loudness", values: signature?.loudness ?? null, cls: "bg-lossless" },
  ];
  const RANGE = 12;

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------- Output device ---------------- */}
      <div className="rounded-2xl bg-surface-container p-5">
        <div className="flex items-start gap-3.5 mb-4">
          <span className="w-10 h-10 rounded-xl bg-primary-container/15 ring-1 ring-primary-container/30 flex items-center justify-center text-primary flex-shrink-0">
            <DeviceIcon className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-on-surface">Output Device</p>
            <p className="text-[12px] text-outline leading-snug">
              {device?.label ? device.label : "Unknown output"}
              {device?.kind && device.kind !== "unknown" ? ` · ${device.kind}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onGetDevices(false)}
            aria-label="Re-scan output devices"
            className="w-9 h-9 rounded-full flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-high transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {devices.supported ? (
          <div className="flex flex-col gap-2">
            {devices.list.length > 0 ? (
              <select
                value={devices.current || devices.list.find((d) => d.current)?.id || ""}
                onChange={(e) => onSetDevice(e.target.value)}
                aria-label="Output device"
                className="px-3 py-2.5 rounded-xl bg-surface-high text-[13px] text-on-surface outline-none"
              >
                {devices.list.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[12px] text-outline">No output devices reported by this platform.</p>
            )}
            {!devices.labelsAvailable && (
              <button
                type="button"
                onClick={() => onGetDevices(true)}
                className="self-start text-[11px] text-primary hover:text-on-surface transition-colors"
              >
                Device names are hidden until the app is allowed to see them — allow
              </button>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-outline">
            This platform does not expose output devices to the app. Name yours below so the right
            correction can be matched.
          </p>
        )}

        <div className="flex items-center gap-2 mt-3">
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && deviceName.trim()) {
                onSetSignature({ deviceLabel: deviceName.trim() });
                setDeviceName("");
              }
            }}
            placeholder="Or name it — e.g. Sennheiser HD 600"
            aria-label="Name the output device"
            className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-surface-high text-[13px] text-on-surface placeholder-outline outline-none focus-visible:ring-1 focus-visible:ring-primary"
          />
          <button
            type="button"
            disabled={!deviceName.trim()}
            onClick={() => {
              onSetSignature({ deviceLabel: deviceName.trim() });
              setDeviceName("");
            }}
            className="px-4 py-2.5 rounded-full bg-primary text-on-primary text-[12px] font-semibold disabled:opacity-30 flex-shrink-0"
          >
            Use
          </button>
        </div>
      </div>

      {/* ---------------- Device correction ---------------- */}
      <div className="rounded-2xl bg-surface-container p-5">
        <div className="flex items-start gap-3.5 mb-3">
          <span className="w-10 h-10 rounded-xl bg-hi-res/15 ring-1 ring-hi-res/30 flex items-center justify-center text-hi-res flex-shrink-0">
            <Headphones className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-on-surface">Device Correction</p>
            <p className="text-[12px] text-outline leading-snug">
              Matched to the output device from AutoEQ&apos;s measured responses, and remembered per device.
            </p>
          </div>
          <Toggle
            checked={signature?.autoDevice ?? true}
            onChange={(v) => onSetSignature({ autoDevice: v })}
            label="Match the device automatically"
          />
        </div>

        {device?.correction ? (
          <div className="flex items-center gap-2 text-[12px] text-lossless mb-3">
            <Check className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">
              {device.headphone?.name ?? "Correction"} · {device.source === "auto" ? "matched automatically" : device.source === "profile" ? "remembered" : "chosen by you"}
            </span>
            <button
              type="button"
              onClick={() => onSetSignature({ clearDevice: true })}
              aria-label="Remove device correction"
              className="ml-auto w-7 h-7 rounded-full flex items-center justify-center text-outline hover:text-danger hover:bg-surface-high"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <p className="text-[12px] text-outline mb-3">
            {device?.message ?? "No correction for this device yet."}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            setPickingHeadphone((v) => !v);
            if (!pickingHeadphone && autoEq.headphones.length === 0) onSearchHeadphones("");
          }}
          className="text-[12px] font-semibold text-primary hover:text-on-surface transition-colors"
        >
          {pickingHeadphone ? "Hide the list" : "Choose a correction by hand"}
        </button>

        {pickingHeadphone && (
          <div className="mt-3">
            <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-xl bg-surface-high mb-2">
              <Search className="w-3.5 h-3.5 text-outline flex-shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSearchHeadphones(query.trim());
                }}
                placeholder="Search AutoEQ — e.g. HD 600"
                aria-label="Search headphones"
                className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-on-surface placeholder-outline"
              />
            </div>
            {autoEq.searching ? (
              <p className="text-[12px] text-outline">Searching…</p>
            ) : (
              <div className="max-h-48 overflow-y-auto scroll-area rounded-xl bg-surface-high/50 divide-y divide-white/5">
                {autoEq.headphones.map((h) => (
                  <button
                    key={`${h.path}/${h.fileName}`}
                    type="button"
                    onClick={() => {
                      onSetSignature({ headphone: h, target: autoEq.targets[0]?.id });
                      setPickingHeadphone(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-container transition-colors"
                  >
                    <span className="text-[12px] text-on-surface-variant truncate flex-1">{h.name}</span>
                    {h.type && <span className="text-[10px] text-outline uppercase tracking-wider">{h.type}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------------- Track + loudness ---------------- */}
      <div className="rounded-2xl bg-surface-container p-5 flex flex-col gap-3">
        <div className="flex items-start gap-3.5">
          <span className="w-10 h-10 rounded-xl bg-primary-container/15 ring-1 ring-primary-container/30 flex items-center justify-center text-primary flex-shrink-0">
            <Layers className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-on-surface">Track Stabiliser</p>
            <p className="text-[12px] text-outline leading-snug">
              Measures the record playing now and pulls its balance toward what you normally play.
            </p>
          </div>
          <Toggle checked={eq.adaptive.on} onChange={(v) => onSetAdaptive({ enabled: v })} label="Track stabiliser" />
        </div>
        <div className="flex items-start gap-3.5">
          <span className="w-10 h-10 rounded-xl bg-lossless/15 ring-1 ring-lossless/30 flex items-center justify-center text-lossless flex-shrink-0">
            <Volume2 className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-on-surface">Loudness Compensation</p>
            <p className="text-[12px] text-outline leading-snug">
              Quiet listening loses bass first. The lower the volume, the more low end comes back.
              {signature?.loudness ? ` Adding ${Math.max(...signature.loudness).toFixed(1)} dB now.` : " Nothing added at this volume."}
            </p>
          </div>
          <Toggle
            checked={signature?.loudnessOn ?? true}
            onChange={(v) => onSetSignature({ loudness: v })}
            label="Loudness compensation"
          />
        </div>
        <div className="flex items-start gap-3.5 pt-3 border-t border-white/8">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-on-surface">All automatic layers</p>
            <p className="text-[12px] text-outline leading-snug">Off leaves only the equaliser you set by hand.</p>
          </div>
          <Toggle checked={signature?.enabled ?? true} onChange={(v) => onSetSignature({ enabled: v })} label="Sound Signature" />
        </div>
      </div>

      {/* ---------------- The layers, drawn ---------------- */}
      {freqs.length > 0 && (
        <div className="rounded-2xl bg-surface-container p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[13px] font-semibold text-on-surface">What the filters are doing</p>
            <div className="flex items-center gap-3 text-[10px]">
              {layers.map((l) => (
                <span key={l.key} className="flex items-center gap-1 text-outline">
                  <span className={`w-2 h-2 rounded-sm ${l.cls}`} />
                  {l.name}
                </span>
              ))}
            </div>
          </div>
          <div className={`flex items-end gap-1 ${compact ? "h-28" : "h-32"}`}>
            {freqs.map((hz, i) => {
              const composed = signature?.composed?.[i] ?? 0;
              return (
                <div key={hz} className="flex-1 flex flex-col items-center gap-1 h-full min-w-0">
                  <div className="relative flex-1 w-full rounded-sm bg-surface-high overflow-hidden">
                    <span className="absolute left-0 right-0 top-1/2 h-px bg-white/15" />
                    {layers.map((l) => {
                      const v = l.values?.[i] ?? 0;
                      if (Math.abs(v) < 0.05) return null;
                      const h = (Math.min(RANGE, Math.abs(v)) / RANGE) * 50;
                      return (
                        <span
                          key={l.key}
                          className={`absolute left-[15%] right-[15%] ${l.cls} opacity-70`}
                          style={v > 0 ? { bottom: "50%", height: `${h}%` } : { top: "50%", height: `${h}%` }}
                          title={`${l.name} ${v > 0 ? "+" : ""}${v.toFixed(1)} dB`}
                        />
                      );
                    })}
                    <span
                      className="absolute left-0 right-0 h-0.5 bg-white"
                      style={{ bottom: `calc(50% + ${(Math.max(-RANGE, Math.min(RANGE, composed)) / RANGE) * 50}%)` }}
                      title={`Total ${composed > 0 ? "+" : ""}${composed.toFixed(1)} dB`}
                    />
                  </div>
                  <span className="text-[8px] text-outline font-mono truncate">{label(hz)}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-outline mt-3 leading-relaxed">
            The white line is the total the filters are running. Your own curve stays saved untouched;
            every other layer is reversible.
          </p>
        </div>
      )}
    </div>
  );
}
