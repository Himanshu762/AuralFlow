"use client";

import React, { useEffect, useState } from "react";
import { Play, Pause, AudioLines, ListMusic, GripVertical, Sparkles, X, Plus } from "lucide-react";
import { usePlayerStore, type Track } from "../stores/playerStore";
import { fmtTime, qualityBadge } from "../lib/format";
import FlowCard from "./FlowCard";

interface Props {
  onPlay: (track: Track) => void;
  onToggle: () => void;
  compact: boolean;
  dj: { playPick: () => void; reject: () => void; refresh: () => void; queuePick: () => void };
  /** Queue operations, which act on the engine's own queue. */
  queue: {
    get: () => void;
    add: (tracks: Track[], next?: boolean) => void;
    remove: (index: number) => void;
    move: (from: number, to: number) => void;
    clear: () => void;
    play: (index: number) => void;
  };
}

export default function QueueTab({ onPlay, onToggle, compact, queue, dj }: Props) {
  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  const items = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const monoReady = usePlayerStore((s) => s.monoReady);
  const djState = usePlayerStore((s) => s.dj);

  /* Ask the engine for its queue once it is up. After that the engine pushes
     an update whenever the queue or the position in it changes. */
  useEffect(() => {
    if (monoReady) queue.get();
  }, [monoReady, queue]);

  /* Everything after the current position. These are real queue indices, so
     removing or reordering acts on the right entry. */
  const upNext = items
    .map((t, i) => ({ track: t, index: i }))
    .filter(({ index }) => index > queueIndex);

  const queued = new Set(items.map((t) => t.id));
  const aiSuggestions = djState.alternates.filter((t) => t.id !== track?.id && !queued.has(t.id)).slice(0, 6);

  /* Drag-to-reorder. The index being dragged lives here; the drop target is
     whichever row the pointer is over. */
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  const endDrag = () => {
    if (dragging !== null && dropTarget !== null && dragging !== dropTarget) {
      queue.move(dragging, dropTarget);
    }
    setDragging(null);
    setDropTarget(null);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const badge = track ? qualityBadge(track) : null;
  const remaining = upNext.reduce((sum, { track: t }) => sum + (t.duration ?? 0), 0);

  if (!track && upNext.length === 0 && !djState.pick) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-center">
        <ListMusic className="w-12 h-12 text-outline mb-4" />
        <p className="text-headline-md text-on-surface-variant">Queue is empty</p>
        <p className="text-body-md text-outline mt-1.5">Play something to start the flow.</p>
      </div>
    );
  }

  return (
    <div className={`grid gap-7 max-w-[1500px] items-start ${compact ? "grid-cols-1" : "xl:grid-cols-[1fr_340px]"}`}>
      <div className="flex flex-col gap-7 min-w-0">
        {/* ============ Now playing ============ */}
        {track && (
          <section>
            <p className="section-eyebrow mb-3">Now Playing</p>
            <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/10 shadow-xl">
              <img
                src={track.coverLarge || track.cover}
                alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-25 blur-2xl scale-125"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-surface-lowest via-surface-lowest/80 to-surface-lowest/40" />

              <div className={`relative flex items-center gap-4 ${compact ? "p-4" : "p-5"}`}>
                <img
                  src={track.coverLarge || track.cover}
                  alt=""
                  className={`rounded-xl object-cover shadow-2xl ring-1 ring-white/10 flex-shrink-0 ${
                    compact ? "w-16 h-16" : "w-20 h-20"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <h2 className={`${compact ? "text-[17px]" : "text-headline-md"} font-semibold text-on-surface truncate`}>
                    {track.title}
                  </h2>
                  <p className="text-[13px] text-on-surface-variant truncate mt-0.5">{track.artist}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {badge && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${badge.cls}`}>
                        {badge.longLabel}
                      </span>
                    )}
                    {track.mood_label && (
                      <span className="text-[10px] text-primary uppercase tracking-wider font-bold">
                        {track.mood_label}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onToggle}
                  aria-label={playing ? "Pause" : "Play"}
                  className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center shadow-xl active:scale-95 transition-transform flex-shrink-0"
                >
                  {playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                </button>
              </div>

              <div className="relative h-[3px] bg-white/10">
                <div className="h-full bg-primary transition-all duration-200" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </section>
        )}

        {/* ============ Up next ============ */}
        {upNext.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <p className="section-eyebrow">Up Next</p>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-outline">
                  {upNext.length} track{upNext.length === 1 ? "" : "s"} · {fmtTime(remaining)}
                </span>
                <button
                  type="button"
                  onClick={queue.clear}
                  className="text-[11px] text-outline hover:text-danger transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-surface-low p-2 flex flex-col gap-0.5">
              {upNext.slice(0, 50).map(({ track: t, index }, i) => {
                const b = qualityBadge(t);
                return (
                  <div
                    key={`${t.id}-${index}`}
                    draggable
                    onDragStart={() => setDragging(index)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropTarget(index);
                    }}
                    onDragEnd={endDrag}
                    onDrop={(e) => {
                      e.preventDefault();
                      endDrag();
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={() => queue.play(index)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        queue.play(index);
                      }
                    }}
                    className={`group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors outline-none focus-visible:ring-1 focus-visible:ring-primary-container ${
                      dragging === index
                        ? "opacity-40"
                        : dropTarget === index && dragging !== null
                          ? "bg-primary-container/20"
                          : "hover:bg-surface-container"
                    }`}
                  >
                    <GripVertical className="w-4 h-4 text-outline/50 group-hover:text-outline flex-shrink-0 cursor-grab active:cursor-grabbing" />
                    <span className="text-[11px] text-outline font-mono w-5 text-center flex-shrink-0">{i + 1}</span>
                    <img src={t.cover} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-on-surface truncate font-medium">{t.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {b && (
                          <span className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider flex-shrink-0 ${b.cls}`}>
                            {b.label}
                          </span>
                        )}
                        <span className="text-[11px] text-outline truncate">{t.artist}</span>
                      </div>
                    </div>
                    <span className="text-[11px] text-outline font-mono flex-shrink-0">{fmtTime(t.duration)}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        queue.remove(index);
                      }}
                      aria-label={`Remove ${t.title} from the queue`}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-outline opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger hover:bg-surface-high transition-all flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* ============ The DJ column ============ */}
      <section className="min-w-0 flex flex-col gap-3">
        <FlowCard compact onPlayPick={dj.playPick} onReject={dj.reject} onRefresh={dj.refresh} onQueuePick={dj.queuePick} dense />

        {aiSuggestions.length > 0 && (
          <>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <p className="section-eyebrow !text-primary">Also in the running</p>
          </div>

          <div className="rounded-xl bg-surface-container/60 p-3 flex flex-col gap-1.5">
            <p className="text-[12px] text-outline leading-relaxed mb-1.5">
              The DJ&apos;s runners-up from your library for this arc. Add one, or play it now.
            </p>
            {aiSuggestions.map((t) => {
              const score = typeof t.fit === "number" ? t.fit : undefined;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPlay(t)}
                  className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-high transition-colors text-left"
                >
                  {t.cover ? (
                    <img
                      src={t.cover}
                      alt=""
                      className="w-9 h-9 rounded object-cover flex-shrink-0 ring-1 ring-primary-container/20"
                    />
                  ) : (
                    <span className="w-9 h-9 rounded bg-surface-high flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-on-surface truncate font-medium">{t.title}</p>
                    <p className="text-[11px] text-outline truncate">{t.artist}</p>
                  </div>
                  {score !== undefined && (
                    <span className="text-[10px] text-primary font-bold font-mono flex-shrink-0">
                      {Math.round(score * 100)}%
                    </span>
                  )}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      queue.add([t]);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        queue.add([t]);
                      }
                    }}
                    aria-label={`Add ${t.title} to the queue`}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-high transition-colors flex-shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </span>
                </button>
              );
            })}
          </div>

          </>
        )}

        {!compact && (
          <div className="rounded-xl bg-surface-container/60 p-3.5 flex items-start gap-2.5">
            <AudioLines className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-outline leading-relaxed">
              Skips, likes and &quot;not this&quot; all feed back into the agent, and every track&apos;s
              mood is measured from the audio as it plays. The more you listen, the tighter the
              picks track your flow.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
