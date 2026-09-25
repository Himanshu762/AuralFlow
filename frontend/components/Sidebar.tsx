"use client";

import React from "react";
import {
  Home as HomeIcon,
  Search,
  Library,
  ListMusic,
  Settings as SettingsIcon,
  AudioLines,
  Heart,
  Clock,
  Cpu,
  Usb,
} from "lucide-react";
import { usePlayerStore, type TabId } from "../stores/playerStore";
import { MOOD_DIMENSIONS } from "../lib/format";
import { uniqueTracks } from "../lib/catalogue";

interface NavEntry {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  /** Right-aligned count or status dot */
  meta?: React.ReactNode;
}

export default function Sidebar() {
  const activeTab = usePlayerStore((s) => s.activeTab);
  const setActiveTab = usePlayerStore((s) => s.setActiveTab);
  const liked = usePlayerStore((s) => s.liked);
  const recentlyPlayed = usePlayerStore((s) => s.recentlyPlayed);
  const searchResults = usePlayerStore((s) => s.searchResults);
  const currentMood = usePlayerStore((s) => s.currentMood);
  const track = usePlayerStore((s) => s.track);
  const aiStats = usePlayerStore((s) => s.aiStats);
  const monoReady = usePlayerStore((s) => s.monoReady);
  const settings = usePlayerStore((s) => s.settings);
  const libraryCount = uniqueTracks(recentlyPlayed, searchResults).length;

  const go = (tab: TabId) => setActiveTab(tab);

  const discover: NavEntry[] = [
    { id: "home", label: "Listen Now", icon: <HomeIcon className="w-[18px] h-[18px]" /> },
    { id: "search", label: "Search", icon: <Search className="w-[18px] h-[18px]" /> },
  ];

  const collection: NavEntry[] = [
    {
      id: "library",
      label: "Library",
      icon: <Library className="w-[18px] h-[18px]" />,
      /* The Library tab lists history and search results together, so count
         the same pool it does — not whichever of the two happens to be
         non-empty. */
      meta: <span className="text-label-sm text-outline">{libraryCount}</span>,
    },
    {
      id: "queue",
      label: "Queue",
      icon: <ListMusic className="w-[18px] h-[18px]" />,
      meta: track ? <span className="w-1.5 h-1.5 rounded-full bg-lossless" /> : undefined,
    },
  ];

  const system: NavEntry[] = [
    { id: "settings", label: "Audio Lab / EQ", icon: <SettingsIcon className="w-[18px] h-[18px]" /> },
  ];

  const renderNav = (entries: NavEntry[]) =>
    entries.map((e) => {
      const isActive = activeTab === e.id;
      return (
        <button
          key={e.id}
          type="button"
          aria-current={isActive ? "page" : undefined}
          onClick={() => go(e.id)}
          className={`nav-item w-full text-left ${isActive ? "is-active" : ""}`}
        >
          <span className={isActive ? "text-primary" : ""}>{e.icon}</span>
          <span className="flex-1 truncate">{e.label}</span>
          {e.meta}
        </button>
      );
    });

  const moodLabel = track?.mood_label || "Not read yet";
  const explorationPct = Math.round(aiStats.explorationRate * 100);

  return (
    <aside className="sidebar select-none">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-6">
        <div className="w-8 h-8 rounded-lg bg-primary-container/20 ring-1 ring-primary-container/40 flex items-center justify-center text-primary-container">
          <AudioLines className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="text-label-md uppercase tracking-[0.1em] font-bold text-on-surface flex items-center gap-1.5">
            AuralFlow
            <span
              className={`w-1.5 h-1.5 rounded-full ${monoReady ? "bg-lossless animate-pulse" : "bg-outline/50"}`}
              title={monoReady ? "Audio engine connected" : "Waiting for audio engine"}
            />
          </div>
          <div className="text-[10px] text-outline tracking-wide">Desktop Pro · v0.1.0</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto hide-scrollbar px-3 pb-2 space-y-5">
        <div className="space-y-1">
          <div className="section-eyebrow px-2 mb-2">Discover</div>
          {renderNav(discover)}
        </div>

        <div className="space-y-1">
          <div className="section-eyebrow px-2 mb-2">My Collection</div>
          {renderNav(collection)}
          <button
            type="button"
            onClick={() => go("library")}
            className="nav-item w-full text-left"
          >
            <Heart className="w-[18px] h-[18px]" />
            <span className="flex-1 truncate">Liked Songs</span>
            <span className="text-label-sm text-outline">{liked.size}</span>
          </button>
          <button
            type="button"
            onClick={() => go("library")}
            className="nav-item w-full text-left"
          >
            <Clock className="w-[18px] h-[18px]" />
            <span className="flex-1 truncate">Recently Played</span>
            <span className="text-label-sm text-outline">{recentlyPlayed.length}</span>
          </button>
        </div>

        <div className="space-y-1">
          <div className="section-eyebrow px-2 mb-2">System</div>
          {renderNav(system)}
        </div>

        {/* Mood Flow mini-indicator — the 5D vector the RL agent is tracking */}
        <div className="space-y-1">
          <div className="section-eyebrow px-2 mb-2">Mood Flow</div>
          <div className="mx-2 rounded-xl bg-surface-container/70 p-3">
            <div className="text-[12px] font-semibold text-on-surface truncate mb-2.5">{moodLabel}</div>
            <div className="flex items-end gap-1.5">
              {currentMood.map((v, i) => (
                <div key={MOOD_DIMENSIONS[i] ?? i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full h-8 flex items-end rounded-sm bg-surface-high overflow-hidden">
                    <div
                      className="w-full bg-primary-container/80 transition-all duration-700 ease-out"
                      style={{ height: `${Math.max(8, Math.min(100, v * 100))}%` }}
                    />
                  </div>
                  <span className="text-[8px] text-outline uppercase tracking-wide">
                    {(MOOD_DIMENSIONS[i] ?? "").slice(0, 3)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* AI DJ status — mirrors the Stitch "DAC Synchronized" footer card */}
      <div className="m-3 rounded-xl bg-surface-container/60 backdrop-blur-md p-3.5">
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              aiStats.online ? "bg-lossless shadow-[0_0_8px_#10b981]" : "bg-outline/50"
            }`}
          />
          <span className={`text-label-sm uppercase tracking-wider ${aiStats.online ? "text-lossless" : "text-outline"}`}>
            {aiStats.online ? "AI DJ Online" : "AI DJ Offline"}
          </span>
        </div>
        <div className="text-label-md font-semibold text-on-surface flex items-center gap-1.5 truncate">
          <Cpu className="w-3.5 h-3.5 text-outline flex-shrink-0" />
          {aiStats.trainingSteps > 0 ? `${aiStats.trainingSteps} training steps` : "Awaiting feedback"}
        </div>
        <div className="text-[10px] text-outline flex items-center justify-between mt-1.5">
          <span>Exploration {explorationPct}%</span>
          <span className="text-on-surface-variant">{aiStats.memorySize} exp</span>
        </div>
        <div className="mt-2 h-1 rounded-full bg-surface-high overflow-hidden">
          <div
            className="h-full bg-primary-container transition-all duration-700"
            style={{ width: `${Math.min(100, explorationPct)}%` }}
          />
        </div>
      </div>

      {/* Output device chip */}
      <div className="mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container/40 text-[11px]">
        <Usb className="w-3.5 h-3.5 text-lossless flex-shrink-0" />
        <span className="text-on-surface-variant truncate">System Output</span>
        <span className="ml-auto text-outline uppercase tracking-wide text-[9px]">
          {settings.streamQuality === "hi-res" ? "24/192" : settings.streamQuality === "lossless" ? "24/48" : "256k"}
        </span>
      </div>
    </aside>
  );
}
