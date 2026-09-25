"use client";

import { useEffect, useState } from "react";

export type FormFactor = "compact" | "regular";

/** Below this width we present the phone/tablet-portrait layout. */
const COMPACT_MAX = 860;

/**
 * Which native layout the shell should present.
 *
 * "regular" — desktop windows: sidebar + inspector + full-width transport.
 * "compact" — phones and narrow tablets: full-bleed content, mini player,
 *              bottom tab bar, OS safe-area insets respected.
 *
 * Driven by width rather than platform so a resized desktop window and a
 * tablet in portrait both get the layout that actually fits.
 */
export function useFormFactor(): FormFactor {
  const [factor, setFactor] = useState<FormFactor>("regular");

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${COMPACT_MAX}px)`);
    const apply = () => setFactor(mq.matches ? "compact" : "regular");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return factor;
}

/** True when running inside the Tauri shell rather than a plain browser. */
export function useIsNative(): boolean {
  const [native, setNative] = useState(false);
  useEffect(() => {
    setNative("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
  }, []);
  return native;
}
