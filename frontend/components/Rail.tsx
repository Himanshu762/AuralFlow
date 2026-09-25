"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  /** Current value, 0..max */
  value: number;
  max: number;
  onChange: (value: number) => void;
  /** Fires continuously while dragging; falls back to onChange when absent. */
  onScrub?: (value: number) => void;
  className?: string;
  fillClassName?: string;
  ariaLabel: string;
  disabled?: boolean;
}

/**
 * Pointer-driven slider used for both seek and volume.
 *
 * Keeps a local "dragging" value so the fill tracks the cursor instantly
 * instead of waiting for the engine's next timeupdate — the fluid,
 * interruptible feel the design system asks for.
 */
export default function Rail({
  value,
  max,
  onChange,
  onScrub,
  className = "",
  fillClassName = "",
  ariaLabel,
  disabled = false,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);

  const safeMax = max > 0 ? max : 1;
  const shown = dragValue ?? value;
  const pct = Math.max(0, Math.min(100, (shown / safeMax) * 100));

  const valueFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      return (x / rect.width) * safeMax;
    },
    [safeMax]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    const v = valueFromEvent(e.clientX);
    setDragValue(v);
    onScrub?.(v);
  };

  useEffect(() => {
    if (dragValue === null) return;

    const move = (e: PointerEvent) => {
      const v = valueFromEvent(e.clientX);
      setDragValue(v);
      onScrub?.(v);
    };
    const up = (e: PointerEvent) => {
      const v = valueFromEvent(e.clientX);
      onChange(v);
      setDragValue(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragValue, valueFromEvent, onChange, onScrub]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const step = safeMax / 20;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(0, value - step));
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(safeMax, value + step));
    }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(safeMax)}
      aria-valuenow={Math.round(shown)}
      aria-disabled={disabled || undefined}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className={`rail group outline-none ${disabled ? "opacity-40 pointer-events-none" : ""} ${className}`}
    >
      <div className="rail-track">
        <div className={`rail-fill ${fillClassName}`} style={{ width: `${pct}%` }} />
      </div>
      <div
        className="rail-thumb"
        style={{ left: `${pct}%`, opacity: dragValue !== null ? 1 : undefined }}
      />
    </div>
  );
}
