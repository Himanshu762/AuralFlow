"use client";

import React, { useEffect, useRef } from "react";
import { usePlayerStore } from "../stores/playerStore";

/**
 * Lyrics for the track playing now.
 *
 * Where the catalogue has timings, the current line is highlighted and the
 * view keeps it centred; where it only has plain text, the words are shown
 * without any pretence of following along.
 */

interface Props {
  onFetch: () => void;
  compact: boolean;
}

export default function LyricsPane({ onFetch, compact }: Props) {
  const lyrics = usePlayerStore((s) => s.lyrics);
  const track = usePlayerStore((s) => s.track);
  const currentTime = usePlayerStore((s) => s.currentTime);

  /* Fetch once per track. The engine answers with empty lyrics rather than
     an error when the catalogue has none, so a miss is not retried. */
  const fetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!track || fetchedFor.current === track.id) return;
    fetchedFor.current = track.id;
    onFetch();
  }, [track, onFetch]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLParagraphElement>(null);

  /* Index of the last line whose timestamp has passed. */
  const activeIndex = lyrics.synced
    ? lyrics.lines.reduce((found, line, i) => (line.time <= currentTime ? i : found), -1)
    : -1;

  useEffect(() => {
    if (activeIndex < 0 || !activeRef.current || !scrollRef.current) return;
    activeRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  const hasAny = lyrics.lines.length > 0 || lyrics.plain.trim().length > 0;
  const forThisTrack = track && lyrics.trackId === track.id;

  if (!track) return null;

  if (!forThisTrack || !hasAny) {
    return (
      <div className="flex items-center justify-center h-full min-h-32">
        <p className="text-[13px] text-outline">
          {forThisTrack ? "No lyrics for this track." : "Looking for lyrics…"}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={`scroll-area h-full overflow-y-auto ${compact ? "px-1" : "px-2"}`}
    >
      {lyrics.synced ? (
        <div className="flex flex-col gap-2.5 py-8">
          {lyrics.lines.map((line, i) => (
            <p
              key={`${line.time}-${i}`}
              ref={i === activeIndex ? activeRef : undefined}
              className={`transition-all duration-300 ${compact ? "text-[17px]" : "text-[20px]"} font-semibold leading-snug ${
                i === activeIndex
                  ? "text-on-surface"
                  : i < activeIndex
                    ? "text-outline/50"
                    : "text-outline"
              }`}
            >
              {line.text}
            </p>
          ))}
        </div>
      ) : (
        <p
          className={`whitespace-pre-wrap py-8 text-on-surface-variant leading-relaxed ${
            compact ? "text-[14px]" : "text-[15px]"
          }`}
        >
          {lyrics.plain}
        </p>
      )}
    </div>
  );
}
