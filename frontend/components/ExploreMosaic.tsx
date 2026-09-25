"use client";

import React from "react";
import { motion } from "framer-motion";

/**
 * Genre mosaic from `search_vision_v2`.
 *
 * Mixed tile sizes with one tall tile carrying vertical type. Each tile runs a
 * real catalogue search rather than opening a curated page, since the genres
 * are queries, not editorial collections.
 */
interface Genre {
  name: string;
  query: string;
  /** Tailwind grid spans — drives the masonry rhythm of the board. */
  span: string;
  gradient: string;
  vertical?: boolean;
}

const GENRES: Genre[] = [
  {
    name: "Jazz",
    query: "jazz",
    span: "col-span-2 row-span-1 aspect-[2.4/1]",
    gradient: "from-orange-600 via-red-600 to-rose-700",
  },
  {
    name: "Classical",
    query: "classical",
    span: "col-span-1 row-span-2 aspect-[1/2.1]",
    gradient: "from-blue-700 via-blue-600 to-cyan-600",
    vertical: true,
  },
  {
    name: "Electronic",
    query: "electronic",
    span: "col-span-1 row-span-1 aspect-[1.15/1]",
    gradient: "from-fuchsia-700 via-purple-700 to-violet-800",
  },
  {
    name: "Ambient",
    query: "ambient",
    span: "col-span-1 row-span-1 aspect-[1.15/1]",
    gradient: "from-emerald-700 via-teal-700 to-cyan-800",
  },
  {
    name: "Hi-Res",
    query: "hi-res",
    span: "col-span-1 row-span-1 aspect-[1.15/1]",
    gradient: "from-violet-700 via-purple-800 to-indigo-900",
  },
  {
    name: "Dolby Atmos",
    query: "dolby atmos",
    span: "col-span-1 row-span-1 aspect-[1.15/1]",
    gradient: "from-sky-700 via-blue-800 to-indigo-900",
  },
  {
    name: "Acoustic",
    query: "acoustic",
    span: "col-span-2 row-span-1 aspect-[2.4/1]",
    gradient: "from-amber-700 via-orange-800 to-stone-800",
  },
];

export default function ExploreMosaic({
  onSelect,
  columns = 3,
}: {
  onSelect: (query: string) => void;
  columns?: number;
}) {
  return (
    <div
      className="grid gap-3 auto-rows-min"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {GENRES.map((g) => (
        <motion.button
          key={g.name}
          type="button"
          onClick={() => onSelect(g.query)}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.985 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className={`relative overflow-hidden rounded-2xl ${g.span} group`}
        >
          <span className={`absolute inset-0 bg-gradient-to-br ${g.gradient}`} />
          {/* Subtle texture so the tiles are not flat fills */}
          <span
            className="absolute inset-0 opacity-30 mix-blend-overlay"
            style={{
              backgroundImage:
                "repeating-linear-gradient(115deg, rgba(255,255,255,0.22) 0px, transparent 2px, transparent 9px)",
            }}
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />

          <span
            className={`absolute font-bold text-white tracking-tight drop-shadow-lg ${
              g.vertical
                ? "vertical-text left-4 top-5 text-[30px]"
                : "left-5 bottom-4 text-[26px]"
            }`}
          >
            {g.name}
          </span>
        </motion.button>
      ))}
    </div>
  );
}
