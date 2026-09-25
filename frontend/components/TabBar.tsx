"use client";

import React from "react";
import {
  Home as HomeIcon,
  Search,
  Library,
  ListMusic,
  SlidersHorizontal,
} from "lucide-react";
import { usePlayerStore, type TabId } from "../stores/playerStore";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "home", label: "Listen", icon: HomeIcon },
  { id: "search", label: "Search", icon: Search },
  { id: "library", label: "Library", icon: Library },
  { id: "queue", label: "Queue", icon: ListMusic },
  { id: "settings", label: "Audio", icon: SlidersHorizontal },
];

/**
 * Platform tab bar for the compact (phone) layout.
 *
 * Edge-to-edge and anchored to the bottom safe area the way iOS and Android
 * tab bars are — not a floating pill. Labels stay visible so the control
 * reads as a system tab bar rather than a row of icons.
 */
export default function TabBar() {
  const activeTab = usePlayerStore((s) => s.activeTab);
  const setActiveTab = usePlayerStore((s) => s.setActiveTab);

  return (
    <nav className="tab-bar" role="tablist" aria-label="Main">
      {TABS.map(({ id, label, icon: Icon }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => setActiveTab(id)}
            className={`tab-bar-item ${isActive ? "is-active" : ""}`}
          >
            <Icon className="w-[22px] h-[22px]" strokeWidth={isActive ? 2.4 : 1.8} />
            <span className="tab-bar-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
