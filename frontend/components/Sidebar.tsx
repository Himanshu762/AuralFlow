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
import { uniqueTracks } from "../lib/catalogue";
import MoodMeter from "./MoodMeter";
import { FlowModeChips } from "./FlowCard";

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
  const track = usePlayerStore((s) => s.track);
  const aiStats = usePlayerStore((s) => s.aiStats);
  const monoReady = usePlayerStore((s) => s.monoReady);
  const dj = usePlayerStore((s) => s.dj);
  const signature = usePlayerStore((s) => s.signature);
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

        {/* Flow — the arc, the mood reading, and what the DJ lined up next */}
        <div className="space-y-1">
          <div className="section-eyebrow px-2 mb-2">Flow</div>
          <div className="mx-2 rounded-xl bg-surface-container/70 p-3 space-y-3">
            <FlowModeChips dense />
            <div>
              <div className="text-[12px] font-semibold text-on-surface truncate mb-2">{moodLabel}</div>
              <MoodMeter vertical />
            </div>
            <div className="pt-2.5 border-t border-white/8">
              <div className="text-[9px] uppercase tracking-wider text-outline font-bold mb-1">Next up</div>
              {dj.pick ? (
                <button
                  type="button"
                  onClick={() => go("home")}
                  className="w-full flex items-center gap-2 text-left"
                >
                  {dj.pick.cover ? (
                    <img src={dj.pick.cover} alt="" className="w-7 h-7 rounded object-cover flex-shrink-0" />
                  ) : (
                    <span className="w-7 h-7 rounded bg-surface-high flex-shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold text-on-surface truncate">{dj.pick.title}</span>
                    <span className="block text-[10px] text-outline truncate">
                      {dj.exploring ? "Discovery · " : ""}
                      {dj.pick.artist}
                    </span>
                  </span>
                </button>
              ) : (
                <span className="text-[11px] text-outline">{dj.deciding ? "Choosing…" : "Nothing lined up"}</span>
              )}
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

      {/* Output device chip — what is playing the sound, and whether it is corrected */}
      <button
        type="button"
        onClick={() => go("settings")}
        className="mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container/40 text-[11px] text-left hover:bg-surface-container transition-colors"
      >
        <Usb className={`w-3.5 h-3.5 flex-shrink-0 ${signature?.device.correction ? "text-hi-res" : "text-lossless"}`} />
        <span className="text-on-surface-variant truncate flex-1">
          {signature?.device.label || "System Output"}
        </span>
        <span className="text-outline uppercase tracking-wide text-[9px] flex-shrink-0">
          {signature?.device.correction ? "Corrected" : signature?.enabled ? "Signature" : "Flat"}
        </span>
      </button>
    </aside>
  );
}
