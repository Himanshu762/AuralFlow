"use client";

import { useEffect, useRef } from "react";
import { usePlayerStore, type TabId } from "../stores/playerStore";

export interface ShortcutHandlers {
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  volume: (level: number) => void;
  setMuted: (muted: boolean) => void;
  /** Focus the search field — the Search tab registers this. */
  focusSearch?: () => void;
}

const TAB_ORDER: TabId[] = ["home", "search", "library", "queue", "settings"];

/** Typing in a field should never trigger transport shortcuts. */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Desktop keyboard shortcuts.
 *
 * Space            play/pause
 * ← / →            seek ∓10s
 * ↑ / ↓            volume ±5%
 * Ctrl/Cmd + ← / → previous / next track
 * Ctrl/Cmd + L     toggle like
 * Ctrl/Cmd + F/K   focus search (switches to the Search tab)
 * Ctrl/Cmd + 1..5  switch tab
 * M                mute
 * S / R            shuffle / repeat
 * Escape           close Now Playing
 * F11              toggle fullscreen
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  /* Kept in a ref so callers may pass a fresh object every render without
     tearing down and re-attaching the window listener. */
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const h = handlersRef.current;
      const s = usePlayerStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      /* Escape and Ctrl+F still work from inside a text field. */
      if (isEditable(e.target) && !(e.key === "Escape" || (mod && e.key.toLowerCase() === "f"))) {
        return;
      }

      /* --- Tab switching: Ctrl/Cmd + 1..5 --- */
      if (mod && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        s.setActiveTab(TAB_ORDER[Number(e.key) - 1]);
        return;
      }

      switch (e.key) {
        case " ":
        case "Spacebar":
          e.preventDefault();
          h.toggle();
          break;

        case "ArrowRight":
          e.preventDefault();
          if (mod) h.next();
          else h.seek(Math.min(s.duration, s.currentTime + 10));
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (mod) h.prev();
          else h.seek(Math.max(0, s.currentTime - 10));
          break;

        case "ArrowUp":
          e.preventDefault();
          h.volume(Math.min(1, s.volume + 0.05));
          break;

        case "ArrowDown":
          e.preventDefault();
          h.volume(Math.max(0, s.volume - 0.05));
          break;

        case "Escape":
          if (s.isExpanded) {
            e.preventDefault();
            s.setIsExpanded(false);
          }
          break;

        case "F11":
          e.preventDefault();
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else document.documentElement.requestFullscreen().catch(() => {});
          break;

        default: {
          const key = e.key.toLowerCase();

          if (mod && key === "l") {
            e.preventDefault();
            if (s.track) s.toggleLike(s.track.id);
            return;
          }
          if (mod && (key === "f" || key === "k")) {
            e.preventDefault();
            s.setActiveTab("search");
            /* Let the tab mount before reaching for its input. */
            requestAnimationFrame(() => h.focusSearch?.());
            return;
          }
          if (mod) return; /* leave every other Ctrl/Cmd chord to the OS */

          if (key === "m") {
            e.preventDefault();
            h.setMuted(!s.muted);
          } else if (key === "s") {
            e.preventDefault();
            s.toggleShuffle();
          } else if (key === "r") {
            e.preventDefault();
            s.cycleRepeat();
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
