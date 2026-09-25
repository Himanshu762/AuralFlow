"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePlayerStore, type Track, type TabId } from "../stores/playerStore";
import { useMonochrome } from "../hooks/useMonochrome";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useFormFactor } from "../hooks/useFormFactor";
import { fetchAiStats } from "../lib/api";
import ShaderBackground from "../components/ShaderBackground";
import Toolbar from "../components/Toolbar";
import Sidebar from "../components/Sidebar";
import TabBar from "../components/TabBar";
import PlayerBar from "../components/PlayerBar";
import MiniPlayer from "../components/MiniPlayer";
import AudioEngineRail from "../components/AudioEngineRail";
import NowPlayingScreen from "../components/NowPlayingScreen";
import HomeTab from "../components/HomeTab";
import SearchTab from "../components/SearchTab";
import LibraryTab from "../components/LibraryTab";
import QueueTab from "../components/QueueTab";
import SettingsTab from "../components/SettingsTab";
import AlbumScreen from "../components/AlbumScreen";
import ArtistScreen from "../components/ArtistScreen";

/** Screen titles for the compact layout, which has no toolbar to carry them. */
const COMPACT_TITLES: Record<TabId, string> = {
  home: "Listen Now",
  search: "Search",
  library: "Library",
  queue: "Queue",
  settings: "Audio Lab",
};

export default function Home() {
  const mono = useMonochrome();
  const formFactor = useFormFactor();
  const compact = formFactor === "compact";

  const activeTab = usePlayerStore((s) => s.activeTab);
  const setActiveTab = usePlayerStore((s) => s.setActiveTab);
  const track = usePlayerStore((s) => s.track);
  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const searchResults = usePlayerStore((s) => s.searchResults);
  const isExpanded = usePlayerStore((s) => s.isExpanded);
  const monoReady = usePlayerStore((s) => s.monoReady);
  const railOpen = usePlayerStore((s) => s.railOpen);
  const setRailOpen = usePlayerStore((s) => s.setRailOpen);
  const setAiStats = usePlayerStore((s) => s.setAiStats);
  const shaderOn = usePlayerStore((s) => s.settings.shaderBackground);
  const detail = usePlayerStore((s) => s.detail);

  /* Pull liked songs and settings out of storage once the client is up.
     Doing it here rather than at store creation keeps the first render
     identical to the server's, so hydration stays clean. */
  useEffect(() => {
    usePlayerStore.getState().hydrate();
  }, []);

  /* ---------------- Navigation history (toolbar chevrons) ---------------- */

  const [history, setHistory] = useState<{ stack: TabId[]; idx: number }>({
    stack: ["home"],
    idx: 0,
  });

  /* Set while the chevrons drive the tab, so replaying history does not
     push a new entry onto it. */
  const replayingRef = useRef(false);

  useEffect(() => {
    if (replayingRef.current) {
      replayingRef.current = false;
      return;
    }
    setHistory((h) => {
      if (h.stack[h.idx] === activeTab) return h;
      const stack = [...h.stack.slice(0, h.idx + 1), activeTab];
      return { stack, idx: stack.length - 1 };
    });
  }, [activeTab]);

  const jumpTo = (idx: number) => {
    replayingRef.current = true;
    setHistory((h) => ({ ...h, idx }));
    setActiveTab(history.stack[idx]);
  };

  /* ---------------- Initial search once the engine is up ---------------- */

  /* Only re-run a search the user actually made. The app used to search a
     canned term on startup, which filled the home screen with results that
     looked like a library but were nobody's. */
  const hasSearchedRef = useRef(false);
  useEffect(() => {
    if (monoReady && !hasSearchedRef.current && searchQuery.trim()) {
      hasSearchedRef.current = true;
      mono.search(searchQuery);
    }
  }, [monoReady, searchQuery, mono]);

  /* ---------------- Poll the RL agent's training status ---------------- */

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const stats = await fetchAiStats();
      if (!cancelled) setAiStats(stats);
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [setAiStats]);

  /* ---------------- Transport commands from the system tray ---------------- */

  useEffect(() => {
    const onTransport = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === "toggle") mono.toggle();
      else if (action === "next") mono.next();
      else if (action === "prev") mono.prev();
    };
    window.addEventListener("auralflow://transport", onTransport);
    return () => window.removeEventListener("auralflow://transport", onTransport);
  }, [mono]);

  /* ---------------- Push audio settings into the engine ---------------- */

  const streamQuality = usePlayerStore((s) => s.settings.streamQuality);
  const headTracking = usePlayerStore((s) => s.settings.headTracking);

  useEffect(() => {
    if (!monoReady) return;
    mono.setQuality(streamQuality);
  }, [monoReady, streamQuality, mono]);

  useEffect(() => {
    if (!monoReady) return;
    mono.setSpatial(headTracking);
  }, [monoReady, headTracking, mono]);

  const dolbyAtmos = usePlayerStore((s) => s.settings.dolbyAtmos);

  useEffect(() => {
    if (!monoReady) return;
    mono.setPreferAtmos(dolbyAtmos);
  }, [monoReady, dolbyAtmos, mono]);

  /* Transport modes live in the engine; mirror the shell's state onto it. */
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);

  useEffect(() => {
    if (monoReady) mono.setRepeat(repeat);
  }, [monoReady, repeat, mono]);

  useEffect(() => {
    if (monoReady) mono.setShuffle(shuffle);
  }, [monoReady, shuffle, mono]);

  /* The inspector needs real estate; never show it in the compact layout. */
  useEffect(() => {
    if (compact) setRailOpen(false);
    else setRailOpen(window.innerWidth >= 1280);
  }, [compact, setRailOpen]);

  /* ---------------- Playback plumbing ---------------- */

  const playTrack = useCallback(
    (t: Track) => {
      mono.play(t.id, searchResults, searchQuery);
    },
    [mono, searchResults, searchQuery]
  );

  const searchInputRef = useRef<HTMLInputElement>(null);

  const focusSearch = useCallback(() => {
    setActiveTab("search");
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [setActiveTab]);

  const shortcutHandlers = useMemo(
    () => ({
      toggle: mono.toggle,
      next: mono.next,
      prev: mono.prev,
      seek: mono.seek,
      volume: mono.volume,
      setMuted: mono.setMuted,
      focusSearch: () => searchInputRef.current?.focus(),
    }),
    [mono]
  );
  useKeyboardShortcuts(shortcutHandlers);

  /* Pull the real record from the catalogue whenever a detail screen opens.
     Without this the screens could only show whichever of the album's tracks
     happened to be in the current search results. */
  useEffect(() => {
    if (!monoReady || !detail?.id) return;
    if (detail.kind === "album") mono.getAlbum(detail.id);
    else mono.getArtist(detail.id);
  }, [monoReady, detail, mono]);

  /* Escape pops a pushed detail screen (Now Playing is handled in the hook). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = usePlayerStore.getState();
      if (e.key === "Escape" && s.detail && !s.isExpanded) {
        s.closeDetail();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------------- Shared pieces ---------------- */

  const detailKey = detail
    ? detail.kind === "album"
      ? `album:${detail.album}:${detail.artist}`
      : `artist:${detail.artist}`
    : null;

  const content = (
    <AnimatePresence mode="wait">
      <motion.div
        key={detailKey ?? activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.14 }}
      >
        {detail?.kind === "album" && (
          <AlbumScreen
            album={detail.album}
            artist={detail.artist}
            cover={detail.cover}
            onPlay={playTrack}
            compact={compact}
          />
        )}
        {detail?.kind === "artist" && (
          <ArtistScreen
            artist={detail.artist}
            cover={detail.cover}
            onPlay={playTrack}
            compact={compact}
          />
        )}
        {!detail && (
          <>
        {activeTab === "home" && <HomeTab onPlay={playTrack} compact={compact} />}
        {activeTab === "search" && (
          <SearchTab onSearch={mono.search} onPlay={playTrack} inputRef={searchInputRef} compact={compact} />
        )}
        {activeTab === "library" && (
          <LibraryTab
            onPlay={playTrack}
            compact={compact}
            onImport={mono.importLibrary}
            onGetOffline={mono.getOffline}
            onPlayOffline={mono.playOffline}
          />
        )}
        {activeTab === "queue" && (
          <QueueTab
            onPlay={playTrack}
            onToggle={mono.toggle}
            compact={compact}
            queue={{
              get: mono.getQueue,
              add: mono.queueAdd,
              remove: mono.queueRemove,
              move: mono.queueMove,
              clear: mono.queueClear,
              play: mono.queuePlay,
            }}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            onVolume={mono.volume}
            compact={compact}
            onPlaybackConfig={mono.setPlaybackConfig}
            onInstances={mono.instances}
            eq={{
              getState: mono.getEqState,
              setEnabled: mono.setEqEnabled,
              setGains: mono.setEqGains,
              setPreamp: mono.setEqPreamp,
              setAdaptive: mono.setAdaptiveEq,
              getPresets: mono.getEqPresets,
              searchHeadphones: mono.searchHeadphones,
              applyAutoEq: mono.applyAutoEq,
            }}
          />
        )}
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );

  const engineFrame = (
    <iframe
      ref={mono.iframeRef}
      src={mono.iframeSrc}
      title="Monochrome audio engine"
      allow="autoplay; encrypted-media; clipboard-read; clipboard-write; display-capture"
      className="w-px h-px absolute opacity-0 pointer-events-none"
    />
  );

  const nowPlaying = (
    <AnimatePresence>
      {track && isExpanded && (
        <NowPlayingScreen
          compact={compact}
          onFetchLyrics={mono.getLyrics}
          onDownload={() => mono.download({ scope: "track" })}
          onMinimize={() => usePlayerStore.getState().setIsExpanded(false)}
          onPlayPause={mono.toggle}
          onNext={mono.next}
          onPrev={mono.prev}
          onSeek={mono.seek}
          onVolume={mono.volume}
        />
      )}
    </AnimatePresence>
  );

  /* ================================================================
     Compact layout — phones and narrow tablets
     ================================================================ */

  if (compact) {
    return (
      <div className="flex flex-col h-[100dvh] w-full bg-bg-pure text-on-surface overflow-hidden">
        {engineFrame}

        <div className="relative flex-1 min-h-0 flex flex-col">
          {shaderOn && <ShaderBackground />}
          <main className="scroll-area flex-1 safe-top px-5 pt-4 pb-6 relative z-10">
            {!detail && (
              <h1 className="text-[30px] font-bold tracking-tight text-on-surface mb-5">
                {COMPACT_TITLES[activeTab]}
              </h1>
            )}
            {content}
          </main>
        </div>

        <AnimatePresence>
          {track && <MiniPlayer onToggle={mono.toggle} onNext={mono.next} />}
        </AnimatePresence>
        <TabBar />
        {nowPlaying}
      </div>
    );
  }

  /* ================================================================
     Regular layout — desktop windows
     ================================================================ */

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-bg-pure text-on-surface selection:bg-primary-container/40 overflow-hidden">
      {engineFrame}

      <Toolbar
        canGoBack={history.idx > 0}
        canGoForward={history.idx < history.stack.length - 1}
        onBack={() => history.idx > 0 && jumpTo(history.idx - 1)}
        onForward={() => history.idx < history.stack.length - 1 && jumpTo(history.idx + 1)}
        onSearch={focusSearch}
      />

      <div className="flex flex-1 min-h-0 relative">
        {shaderOn && <ShaderBackground />}

        <Sidebar />

        <main className="scroll-area flex-1 min-w-0 px-8 py-7 relative z-10">{content}</main>

        <AnimatePresence initial={false}>
          {railOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "var(--spacing-rail)", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              className="relative z-10 overflow-hidden flex-shrink-0"
            >
              <AudioEngineRail onPlay={playTrack} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <PlayerBar
        onToggle={mono.toggle}
        onNext={mono.next}
        onPrev={mono.prev}
        onSeek={mono.seek}
        onVolume={mono.volume}
        onMute={mono.setMuted}
      />

      {nowPlaying}
    </div>
  );
}
