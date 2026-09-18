"use client";

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipForward, SkipBack, Heart,
  Search, ListMusic, Home as HomeIcon, Library,
  GripHorizontal, Music2,
} from "lucide-react";
import { usePlayerStore, type Track, type TabId } from "../stores/playerStore";
import { useMonochrome } from "../hooks/useMonochrome";
import ShaderBackground from "../components/ShaderBackground";
import NowPlayingScreen from "../components/NowPlayingScreen";
import HomeTab from "../components/HomeTab";
import SearchTab from "../components/SearchTab";
import LibraryTab from "../components/LibraryTab";
import QueueTab from "../components/QueueTab";

function fmtTime(s: number) {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function qualityBadge(track: Track) {
  if (track.audioQuality === "HI_RES_LOSSLESS")
    return { label: "Hi-Res", cls: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
  if (track.audioQuality === "LOSSLESS")
    return { label: "Lossless", cls: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
  if (track.audioModes?.includes("DOLBY_ATMOS"))
    return { label: "Atmos", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  return null;
}

export default function Home() {
  const mono = useMonochrome();

  const activeTab = usePlayerStore((s) => s.activeTab);
  const setActiveTab = usePlayerStore((s) => s.setActiveTab);
  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const loading = usePlayerStore((s) => s.loading);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const monoReady = usePlayerStore((s) => s.monoReady);
  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const searchResults = usePlayerStore((s) => s.searchResults);
  const isExpanded = usePlayerStore((s) => s.isExpanded);
  const setIsExpanded = usePlayerStore((s) => s.setIsExpanded);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);

  /* Initial search on ready */
  const hasSearchedRef = useRef(false);
  useEffect(() => {
    if (monoReady && !hasSearchedRef.current) {
      hasSearchedRef.current = true;
      mono.search(searchQuery);
    }
  }, [monoReady, searchQuery, mono]);

  /* Progress drag */
  const progressRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const handleProgressPointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    seekFromEvent(e);
  };

  const seekFromEvent = (e: React.PointerEvent | PointerEvent) => {
    if (!progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    mono.seek((x / rect.width) * duration);
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (isDraggingRef.current) seekFromEvent(e);
    };
    const handleUp = () => { isDraggingRef.current = false; };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [duration]);

  const playTrack = (t: Track) => {
    mono.play(t.id, searchResults, searchQuery);
  };

  const navItems: { id: TabId; icon: React.ReactNode; label: string }[] = [
    { id: "home", icon: <HomeIcon className="w-6 h-6" />, label: "Home" },
    { id: "search", icon: <Search className="w-6 h-6" />, label: "Search" },
    { id: "library", icon: <Library className="w-6 h-6" />, label: "Library" },
    { id: "queue", icon: <ListMusic className="w-6 h-6" />, label: "Queue" },
  ];

  return (
    <div className="flex flex-col h-[100dvh] bg-black text-white selection:bg-white/20 relative overflow-hidden">
      {/* Hidden Monochrome iframe */}
      <iframe
        ref={mono.iframeRef}
        src={mono.iframeSrc}
        allow="autoplay; encrypted-media; clipboard-read; clipboard-write; display-capture"
        className="w-[1px] h-[1px] absolute opacity-0 pointer-events-none"
      />

      <ShaderBackground />

      {/* Top Bar */}
      <header className="fixed top-0 left-0 right-0 glass-panel border-b-0 flex justify-between items-center px-5 py-3 w-full z-40 rounded-none bg-black/10">
        <button className="active:scale-95 transition-transform text-white/80">
          <GripHorizontal className="w-5 h-5" />
        </button>
        <div className="text-lg font-bold tracking-tighter text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
          AuralFlow
        </div>
        <button className="active:scale-95 transition-transform">
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border-2 border-blue-500/30">
            <Music2 className="w-4 h-4 text-blue-400" />
          </div>
        </button>
      </header>

      {/* Scrollable Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative z-10 pt-16 pb-48 px-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === "home" && <HomeTab onPlay={playTrack} />}
            {activeTab === "search" && <SearchTab onSearch={mono.search} onPlay={playTrack} />}
            {activeTab === "library" && <LibraryTab onPlay={playTrack} />}
            {activeTab === "queue" && <QueueTab onPlay={playTrack} onToggle={mono.toggle} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Control Pod */}
      <AnimatePresence>
        {track && !isExpanded && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-24 left-3 right-3 z-50 cursor-pointer"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              setIsExpanded(true);
            }}
          >
            <div className="control-pod p-3 relative overflow-hidden">
              {/* Progress */}
              <div
                className="absolute top-0 left-0 right-0 h-[3px] bg-white/10 cursor-pointer"
                ref={progressRef}
                onPointerDown={handleProgressPointerDown}
              >
                <div
                  className="h-full bg-white transition-all duration-75"
                  style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                />
              </div>

              <div className="flex items-center gap-3 mt-0.5">
                <img
                  src={track.coverLarge || track.cover}
                  alt={track.title}
                  className="w-11 h-11 rounded-xl object-cover shadow-xl"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-sm font-bold truncate tracking-tight">{track.title}</h2>
                    {qualityBadge(track) && (
                      <span className={`text-[7px] font-bold px-1 py-0.5 rounded border uppercase tracking-wider flex-shrink-0 ${qualityBadge(track)!.cls}`}>
                        {qualityBadge(track)!.label}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/50 truncate">{track.artist}</p>
                </div>

                <div className="flex items-center gap-1">
                  <button onClick={mono.prev} className="p-1.5 text-white/70 active:scale-90">
                    <SkipBack className="w-5 h-5" />
                  </button>
                  <button
                    onClick={mono.toggle}
                    className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center active:scale-95 play-btn-glow"
                  >
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    ) : playing ? (
                      <Pause className="w-5 h-5 fill-black" />
                    ) : (
                      <Play className="w-5 h-5 fill-black ml-0.5" />
                    )}
                  </button>
                  <button onClick={mono.next} className="p-1.5 text-white/70 active:scale-90">
                    <SkipForward className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Nav */}
      <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex justify-around items-center h-14 w-[88%] max-w-sm bg-black/60 backdrop-blur-[40px] border-t border-t-blue-500/60 border-b border-b-white/5 border-x border-x-white/5 shadow-[0_-5px_25px_rgba(59,130,246,0.2),0_20px_40px_rgba(0,0,0,0.8)] rounded-full px-3">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`relative flex flex-col items-center justify-center active:scale-95 transition-all duration-300 w-14 h-full ${
                isActive ? "text-blue-400" : "text-white/50"
              }`}
            >
              {isActive && (
                <div className="absolute -top-px w-7 h-[3px] bg-blue-500 rounded-b-md shadow-[0_0_12px_rgba(59,130,246,1)]" />
              )}
              <div className={isActive ? "drop-shadow-[0_0_6px_rgba(59,130,246,0.8)]" : ""}>
                {item.icon}
              </div>
            </button>
          );
        })}
      </nav>

      {/* Full Screen Now Playing */}
      <AnimatePresence>
        {track && isExpanded && (
          <NowPlayingScreen
            onMinimize={() => setIsExpanded(false)}
            onPlayPause={mono.toggle}
            onNext={mono.next}
            onPrev={mono.prev}
            onSeek={mono.seek}
            onVolume={mono.volume}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
