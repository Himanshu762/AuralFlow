"use client";

import React from "react";
import { ChevronRight } from "lucide-react";

interface Props {
  title: React.ReactNode;
  /** Second line under the title, as the native boards use. */
  subtitle?: string;
  /** Shows a "See All ›" affordance when provided. */
  onSeeAll?: () => void;
  seeAllLabel?: string;
  /** Small accent dot, used for "something new here". */
  dot?: boolean;
  accent?: boolean;
}

/**
 * Shelf heading shared by every tab.
 *
 * Combines the accent bar from the vision boards with the title/subtitle and
 * "See All" affordance from the native boards.
 */
export default function SectionHeading({
  title,
  subtitle,
  onSeeAll,
  seeAllLabel = "See All",
  dot = false,
  accent = false,
}: Props) {
  return (
    <div className="flex items-end justify-between gap-4 mb-3.5">
      <div className="min-w-0">
        <h2 className="text-[19px] font-semibold tracking-tight text-on-surface flex items-center gap-2">
          <span className={`w-1 h-4.5 rounded-full flex-shrink-0 ${accent ? "bg-primary" : "bg-primary-container"}`} />
          <span className="truncate">{title}</span>
          {dot && <span className="w-1.5 h-1.5 rounded-full bg-primary-container flex-shrink-0" />}
        </h2>
        {subtitle && <p className="text-[12px] text-outline mt-1 ml-3 truncate">{subtitle}</p>}
      </div>

      {onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="flex items-center gap-0.5 text-[12px] font-semibold text-primary hover:text-on-surface transition-colors flex-shrink-0"
        >
          {seeAllLabel}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
