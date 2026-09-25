"use client";

import React, { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Upload, FileMusic, CheckCircle2, AlertCircle, X, Loader2 } from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";

/**
 * Bring a library across from another service.
 *
 * Every mainstream player can export what you have — Spotify through Exportify
 * or TuneMyMusic, Apple Music through its own library XML, most others as M3U
 * or XSPF. Those exports name tracks; this panel hands them to the audio
 * engine, which looks each one up in its own catalogue and reports what it
 * found. Matching is exact where the export carries an ISRC and falls back to
 * title and artist otherwise, so what comes across is the same recording
 * rather than a cover or a remaster.
 */

interface Props {
  onImport: (text: string, format: string, sourceName: string) => void;
  compact: boolean;
}

/** Which parser the engine should use, chosen from the file's extension. */
function formatFor(filename: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "tsv" || ext === "txt") return "csv";
  if (ext === "jspf" || ext === "json") return "jspf";
  if (ext === "xspf") return "xspf";
  if (ext === "xml" || ext === "plist") return "xml";
  if (ext === "m3u" || ext === "m3u8") return "m3u";
  return null;
}

const SOURCES = [
  { name: "Spotify", how: "Export with Exportify or TuneMyMusic → CSV" },
  { name: "Apple Music", how: "File → Library → Export Library → XML" },
  { name: "YouTube Music", how: "Google Takeout → CSV" },
  { name: "Tidal · Deezer", how: "Soundiiz or TuneMyMusic → CSV" },
  { name: "Anything else", how: "M3U, M3U8, XSPF or JSPF playlist files" },
];

export default function ImportPanel({ onImport, compact }: Props) {
  const importState = usePlayerStore((s) => s.importState);
  const resetImport = usePlayerStore((s) => s.resetImport);
  const monoReady = usePlayerStore((s) => s.monoReady);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const accept = useCallback(
    async (file: File) => {
      const format = formatFor(file.name);
      if (!format) {
        setRejected(`${file.name} is not a playlist export this can read.`);
        return;
      }
      setRejected(null);
      onImport(await file.text(), format, file.name.replace(/\.[^.]+$/, ""));
    },
    [onImport]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void accept(file);
    },
    [accept]
  );

  const { running, done, error, matched, missing, current, total, item } = importState;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  /* ---------------- Running ---------------- */

  if (running) {
    return (
      <div className="rounded-2xl bg-surface-container p-6">
        <div className="flex items-center gap-3 mb-4">
          <Loader2 className="w-5 h-5 text-primary animate-spin flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-on-surface">Matching your library</p>
            <p className="text-[12px] text-outline truncate">
              {item ? `Looking up ${item}` : "Reading the file…"}
            </p>
          </div>
        </div>

        <div className="h-1.5 rounded-full bg-surface-high overflow-hidden mb-2">
          <motion.div
            className="h-full bg-primary rounded-full"
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-outline">
          <span>
            {current} of {total || "?"}
          </span>
          <span>{matched.length} matched</span>
        </div>

        <p className="text-[11px] text-outline mt-4 leading-relaxed">
          Each track is looked up individually and paced to stay under the
          catalogue&apos;s rate limit, so a long playlist takes a few minutes. You can
          keep listening while it runs.
        </p>
      </div>
    );
  }

  /* ---------------- Finished ---------------- */

  if (done) {
    return (
      <div className="rounded-2xl bg-surface-container p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            {error ? (
              <AlertCircle className="w-5 h-5 text-danger flex-shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-lossless flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-on-surface">
                {error ? "Import failed" : "Import complete"}
              </p>
              <p className="text-[12px] text-outline">
                {error
                  ? error
                  : `${matched.length} of ${matched.length + missing.length} tracks found in the catalogue`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetImport}
            aria-label="Dismiss"
            className="w-7 h-7 rounded-full flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-high transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!error && matched.length > 0 && (
          <p className="text-[12px] text-on-surface-variant mb-4">
            Saved to your playlists. Open it from the Library to play it.
          </p>
        )}

        {missing.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-outline mb-2">
              {missing.length} not found
            </p>
            <div className="max-h-52 overflow-y-auto scroll-area rounded-lg bg-surface-high/50 divide-y divide-white/5">
              {missing.map((m, i) => (
                <div key={`${m.title}-${i}`} className="px-3 py-2">
                  <p className="text-[12px] text-on-surface-variant truncate">
                    {m.title || "Untitled"}
                  </p>
                  <p className="text-[11px] text-outline truncate">{m.artist}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-outline mt-2.5 leading-relaxed">
              These are usually tracks the catalogue does not carry, or local
              files that were never on a streaming service.
            </p>
          </div>
        )}
      </div>
    );
  }

  /* ---------------- Idle ---------------- */

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`rounded-2xl border border-dashed p-8 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-primary bg-primary-container/10"
            : "border-white/15 bg-surface-container hover:border-white/30"
        }`}
      >
        <Upload className={`w-8 h-8 mx-auto mb-3 ${dragging ? "text-primary" : "text-outline"}`} />
        <p className="text-[15px] font-semibold text-on-surface mb-1">
          Drop a playlist export here
        </p>
        <p className="text-[12px] text-outline">
          CSV, XML, M3U, XSPF or JSPF — or click to choose a file
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xml,.plist,.m3u,.m3u8,.xspf,.jspf,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void accept(file);
            /* Clear it so choosing the same file twice still fires. */
            e.target.value = "";
          }}
        />
      </div>

      {rejected && (
        <p className="text-[12px] text-danger mt-3 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {rejected}
        </p>
      )}

      {!monoReady && (
        <p className="text-[12px] text-outline mt-3">
          Waiting for the audio engine to start before an import can be matched.
        </p>
      )}

      <div className={`mt-5 grid gap-2.5 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
        {SOURCES.map((s) => (
          <div key={s.name} className="flex items-start gap-2.5 rounded-xl bg-surface-container p-3">
            <FileMusic className="w-4 h-4 text-outline flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-on-surface">{s.name}</p>
              <p className="text-[11px] text-outline leading-snug">{s.how}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
