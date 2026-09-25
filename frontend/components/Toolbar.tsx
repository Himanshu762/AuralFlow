"use client";

import React, { useEffect, useState } from "react";
import { Minus, Square, X, Copy, ChevronLeft, ChevronRight, Search, PanelRight, Waves } from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";

/* ------------------------------------------------------------------ */
/* Tauri window bridge — absent in a plain browser, so loaded lazily   */
/* ------------------------------------------------------------------ */

type TauriWindow = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  close: () => Promise<void>;
};

async function getTauriWindow(): Promise<TauriWindow | null> {
  if (typeof window === "undefined") return null;
  if (!("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) return null;
  try {
    const mod = await import("@tauri-apps/api/window");
    return mod.getCurrentWindow() as unknown as TauriWindow;
  } catch {
    return null;
  }
}

interface Props {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onSearch: () => void;
}

/**
 * The window toolbar.
 *
 * This is the app's only top-edge chrome: window controls, history and
 * search sit in one native toolbar strip that doubles as the drag region.
 * There is no separate page header — nothing here scrolls with content.
 */
export default function Toolbar({ canGoBack, canGoForward, onBack, onForward, onSearch }: Props) {
  const [platform, setPlatform] = useState<"mac" | "other">("other");
  const [native, setNative] = useState(false);
  const [maximized, setMaximized] = useState(false);

  const monoReady = usePlayerStore((s) => s.monoReady);
  const railOpen = usePlayerStore((s) => s.railOpen);
  const toggleRail = usePlayerStore((s) => s.toggleRail);

  useEffect(() => {
    if (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)) {
      setPlatform("mac");
    }
    getTauriWindow().then((w) => {
      if (!w) return;
      setNative(true);
      w.isMaximized().then(setMaximized).catch(() => {});
    });
  }, []);

  const call = async (action: "min" | "max" | "close") => {
    const w = await getTauriWindow();
    if (!w) return;
    if (action === "min") await w.minimize();
    if (action === "close") await w.close();
    if (action === "max") {
      await w.toggleMaximize();
      setMaximized(await w.isMaximized());
    }
  };

  return (
    <div className="toolbar" data-tauri-drag-region>
      {/* --- Left cluster: window controls (macOS) then history --- */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {native && platform === "mac" && (
          <div className="flex items-center gap-2 mr-1">
            <button aria-label="Close window" onClick={() => call("close")} className="traffic-light bg-danger" />
            <button aria-label="Minimize window" onClick={() => call("min")} className="traffic-light bg-tertiary-container" />
            <button aria-label="Zoom window" onClick={() => call("max")} className="traffic-light bg-success" />
          </div>
        )}

        <div className="flex items-center gap-1 no-drag">
          <button
            type="button"
            onClick={onBack}
            disabled={!canGoBack}
            aria-label="Back"
            className="toolbar-btn"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onForward}
            disabled={!canGoForward}
            aria-label="Forward"
            className="toolbar-btn"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* --- Center: search field --- */}
      <div className="flex-1 flex justify-center px-4 min-w-0">
        <button
          type="button"
          onClick={onSearch}
          className="no-drag flex items-center gap-2 h-7 pl-3 pr-2 rounded-md bg-surface-container/80 hover:bg-surface-high text-outline hover:text-on-surface transition-colors w-full max-w-sm"
        >
          <Search className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="text-[12px] truncate flex-1 text-left">Search</span>
          <kbd className="text-[10px] font-semibold px-1 py-0.5 rounded bg-surface-high text-outline">⌘K</kbd>
        </button>
      </div>

      {/* --- Right cluster: engine status, inspector, window controls --- */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-md no-drag" title="Audio engine status">
          <Waves className={`w-3.5 h-3.5 ${monoReady ? "text-dolby-atmos" : "text-outline"}`} />
          <span className="text-[11px] text-outline">{monoReady ? "Bit-perfect" : "Starting…"}</span>
        </div>

        <button
          type="button"
          onClick={toggleRail}
          aria-label="Toggle inspector"
          aria-pressed={railOpen}
          className={`toolbar-btn no-drag ${railOpen ? "text-primary" : ""}`}
        >
          <PanelRight className="w-4 h-4" />
        </button>

        {native && platform !== "mac" && (
          <div className="flex items-center gap-1 ml-1 no-drag">
            <button aria-label="Minimize" onClick={() => call("min")} className="window-btn">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              aria-label={maximized ? "Restore" : "Maximize"}
              onClick={() => call("max")}
              className="window-btn"
            >
              {maximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
            </button>
            <button aria-label="Close" onClick={() => call("close")} className="window-btn is-close">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
