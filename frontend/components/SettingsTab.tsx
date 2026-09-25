"use client";

import React from "react";
import {
  Wifi, Radio, Headphones, Download, Sparkles, Waves, Keyboard, Info, Clock, Heart,
} from "lucide-react";
import { usePlayerStore, type AudioSettings, type PlayerState } from "../stores/playerStore";

type AutoEqHeadphone = PlayerState["autoEq"]["headphones"][number];
import { Toggle } from "./AudioEngineRail";
import Rail from "./Rail";
import Equalizer from "./Equalizer";

interface Props {
  onVolume: (level: number) => void;
  compact: boolean;
  /** Points the engine at a streaming endpoint at runtime. */
  onPlaybackConfig: (baseUrl: string, token: string) => void;
  /** Reads or changes the catalogue/streaming backends the engine uses. */
  onInstances: (opts: {
    add?: { url: string; type: "api" | "streaming" }[];
    remove?: { url: string; type: "api" | "streaming" }[];
    refresh?: boolean;
  }) => void;
  /** Equaliser controls, handed down from the engine bridge. */
  eq: {
    getState: () => void;
    setEnabled: (enabled: boolean) => void;
    setGains: (gains: number[]) => void;
    setPreamp: (db: number) => void;
    setAdaptive: (opts: { enabled: boolean; tilt?: number; strength?: number }) => void;
    getPresets: () => void;
    searchHeadphones: (query?: string) => void;
    applyAutoEq: (headphone: AutoEqHeadphone, target: string) => void;
  };
}

const QUALITY_TIERS: {
  id: AudioSettings["streamQuality"];
  label: string;
  spec: string;
  badge: string;
  badgeCls: string;
}[] = [
  {
    id: "hi-res",
    label: "Hi-Res Lossless",
    spec: "24-bit / 192 kHz",
    badge: "HI-RES",
    badgeCls: "bg-hi-res/10 text-hi-res ring-1 ring-hi-res/40",
  },
  {
    id: "lossless",
    label: "Lossless",
    spec: "24-bit / 48 kHz",
    badge: "ALAC",
    badgeCls: "bg-lossless/10 text-lossless ring-1 ring-lossless/40",
  },
  {
    id: "high",
    label: "High Quality",
    spec: "256 kbps AAC",
    badge: "AAC",
    badgeCls: "bg-surface-high text-outline ring-1 ring-white/10",
  },
];

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Seek ∓10 seconds"],
  ["↑ / ↓", "Volume ±5%"],
  ["⌘/Ctrl + ← / →", "Previous / next track"],
  ["⌘/Ctrl + K", "Search"],
  ["⌘/Ctrl + L", "Like current track"],
  ["⌘/Ctrl + 1…5", "Switch section"],
  ["M · S · R", "Mute · shuffle · repeat"],
  ["Esc", "Close now playing"],
  ["F11", "Fullscreen"],
];

export default function SettingsTab({ onVolume, compact, eq, onPlaybackConfig, onInstances }: Props) {
  const settings = usePlayerStore((s) => s.settings);
  const setSetting = usePlayerStore((s) => s.setSetting);
  const volume = usePlayerStore((s) => s.volume);
  const aiStats = usePlayerStore((s) => s.aiStats);
  const monoReady = usePlayerStore((s) => s.monoReady);
  const recentlyPlayed = usePlayerStore((s) => s.recentlyPlayed);
  const clearHistory = usePlayerStore((s) => s.clearHistory);
  const liked = usePlayerStore((s) => s.liked);
  const playbackConfigured = usePlayerStore((s) => s.playbackConfigured);

  return (
    <div className={`flex flex-col gap-5 ${compact ? "max-w-full" : "max-w-3xl"}`}>
      {/* ============ Streaming quality ============ */}
      <Card icon={Wifi} title="Streaming Quality" subtitle="Preferred tier when a track offers more than one master.">
        <div className="flex flex-col gap-1.5">
          {QUALITY_TIERS.map((tier) => {
            const active = settings.streamQuality === tier.id;
            return (
              <button
                key={tier.id}
                type="button"
                onClick={() => setSetting("streamQuality", tier.id)}
                aria-pressed={active}
                className={`flex items-center gap-3 px-3.5 py-3 rounded-xl transition-colors text-left ${
                  active ? "bg-surface-high ring-1 ring-primary-container/50" : "bg-surface-low hover:bg-surface-container"
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    active ? "border-primary-container" : "border-outline/50"
                  }`}
                >
                  {active && <span className="w-2 h-2 rounded-full bg-primary-container" />}
                </span>
                <span className={`text-[14px] font-medium flex-1 ${active ? "text-on-surface" : "text-on-surface-variant"}`}>
                  {tier.label}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${tier.badgeCls}`}>
                  {tier.badge}
                </span>
                <span className="text-[12px] text-outline font-mono w-32 text-right hidden sm:block">
                  {tier.spec}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-outline mt-3 leading-relaxed">
          AuralFlow always requests the best master the source exposes; this setting caps the
          request when bandwidth or storage matters.
        </p>
      </Card>

      {/* ============ Spatial audio ============ */}
      {/* The equaliser this screen is named for */}
      <Equalizer
        onGetState={eq.getState}
        onSetEnabled={eq.setEnabled}
        onSetGains={eq.setGains}
        onSetPreamp={eq.setPreamp}
        onSetAdaptive={eq.setAdaptive}
        onGetPresets={eq.getPresets}
        onSearchHeadphones={eq.searchHeadphones}
        onApplyAutoEq={eq.applyAutoEq}
        compact={compact}
      />

      <Card icon={Radio} title="Spatial Audio" subtitle="Immersive rendering for Atmos and binaural masters.">
        <Row
          icon={Waves}
          title="Dolby Atmos"
          subtitle="Play the spatial master when one exists."
          badge={{ text: "ATMOS", cls: "bg-dolby-atmos/10 text-dolby-atmos ring-1 ring-dolby-atmos/40" }}
        >
          <Toggle
            checked={settings.dolbyAtmos}
            onChange={(v) => setSetting("dolbyAtmos", v)}
            label="Dolby Atmos"
          />
        </Row>
        <Row
          icon={Headphones}
          title="Head Tracking"
          subtitle="Dynamic soundstage that follows head movement."
        >
          <Toggle
            checked={settings.headTracking}
            onChange={(v) => setSetting("headTracking", v)}
            label="Head tracking"
          />
        </Row>
      </Card>

      {/* ============ Output ============ */}
      <Card icon={Download} title="Output" subtitle="Master volume and visual load.">
        <div className="px-3.5 py-3 rounded-xl bg-surface-low">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[14px] text-on-surface font-medium">Master volume</span>
            <span className="text-[12px] text-outline font-mono">{Math.round(volume * 100)}%</span>
          </div>
          <Rail value={volume} max={1} onChange={onVolume} onScrub={onVolume} ariaLabel="Master volume" />
        </div>

        <Row
          icon={Sparkles}
          title="Ambient Shader"
          subtitle="Animated WebGL backdrop. Turn off to save battery."
        >
          <Toggle
            checked={settings.shaderBackground}
            onChange={(v) => setSetting("shaderBackground", v)}
            label="Ambient shader"
          />
        </Row>
      </Card>

      {/* ============ AI DJ ============ */}
      <Card icon={Sparkles} title="AI DJ" subtitle="The reinforcement-learning agent that ranks what plays next.">
        <Row
          icon={Sparkles}
          title="Adaptive Flow"
          subtitle="Send play, skip and like signals back to the agent."
        >
          <Toggle
            checked={settings.adaptiveDj}
            onChange={(v) => setSetting("adaptiveDj", v)}
            label="Adaptive flow"
          />
        </Row>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
          <Stat label="Status" value={aiStats.online ? "Online" : "Offline"} tone={aiStats.online ? "text-lossless" : "text-outline"} />
          <Stat label="Exploration" value={`${Math.round(aiStats.explorationRate * 100)}%`} />
          <Stat label="Replay buffer" value={`${aiStats.memorySize}`} />
          <Stat label="Train steps" value={`${aiStats.trainingSteps}`} />
          <Stat
            label="Last reward"
            value={aiStats.lastReward === null ? "—" : aiStats.lastReward.toFixed(2)}
            tone={
              aiStats.lastReward === null
                ? "text-outline"
                : aiStats.lastReward >= 0
                  ? "text-lossless"
                  : "text-danger"
            }
          />
        </div>

        <div className="flex items-start gap-2 mt-3 text-[11px] text-outline leading-relaxed">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Exploration falls as the agent learns, so recommendations tighten the longer you listen.
            Progress is checkpointed to disk, so it carries across restarts. Turning Adaptive Flow
            off stops new feedback but keeps what it has already learnt.
          </span>
        </div>
      </Card>

      {/* ============ Data ============ */}
      <Card icon={Clock} title="Listening History" subtitle="Kept on this device to seed your library and the agent.">
        <Row
          icon={Clock}
          title="Recently played"
          subtitle={
            recentlyPlayed.length > 0
              ? `${recentlyPlayed.length} ${recentlyPlayed.length === 1 ? "track" : "tracks"} remembered`
              : "Nothing played yet"
          }
        >
          <button
            type="button"
            onClick={clearHistory}
            disabled={recentlyPlayed.length === 0}
            className="px-3.5 py-2 rounded-full bg-surface-high text-[12px] font-semibold text-on-surface-variant hover:text-danger transition-colors disabled:opacity-30 flex-shrink-0"
          >
            Clear
          </button>
        </Row>
        <Row icon={Heart} title="Liked songs" subtitle={`${liked.size} saved on this device`}>
          <span className="text-[12px] text-outline font-mono flex-shrink-0">{liked.size}</span>
        </Row>
      </Card>

      {/* ============ Backends ============ */}
      <Card
        icon={Wifi}
        title="Catalogue & Streaming"
        subtitle="Where the audio engine fetches music from."
      >
        <Instances onChange={onInstances} />
      </Card>

      {/* ============ Streaming endpoint ============ */}
      <Card
        icon={Wifi}
        title="Streaming Endpoint"
        subtitle="Only needed if you have your own. Playback works without one."
      >
        <PlaybackEndpoint onSubmit={onPlaybackConfig} configured={playbackConfigured} />
      </Card>

      {/* ============ Keyboard ============ */}
      {!compact && (
        <Card icon={Keyboard} title="Keyboard" subtitle="Shortcuts available anywhere in the app.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys} className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-[13px] text-on-surface-variant truncate">{action}</span>
                <kbd className="px-2 py-1 rounded bg-surface-high text-[11px] text-outline font-mono flex-shrink-0">
                  {keys}
                </kbd>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ============ About ============ */}
      <Card icon={Info} title="About" subtitle="AuralFlow · lossless playback with a learning DJ.">
        <div className="flex flex-col gap-1.5 text-[13px]">
          <AboutRow label="Version" value="0.1.0" />
          <AboutRow label="Audio engine" value={monoReady ? "Monochrome · connected" : "Monochrome · not reachable"} />
          <AboutRow
            label="Playback"
            value={playbackConfigured ? "Streaming endpoint configured" : "No endpoint — search only"}
          />
          <AboutRow label="Recommendation API" value={aiStats.online ? "Connected" : "Not reachable"} />
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Card({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-surface-container/70 backdrop-blur-xl p-5 ring-1 ring-white/6">
      <div className="flex items-center gap-2.5 mb-1">
        <Icon className="w-5 h-5 text-primary flex-shrink-0" />
        <h2 className="text-headline-md text-on-surface">{title}</h2>
      </div>
      <p className="text-[13px] text-outline mb-4 leading-relaxed">{subtitle}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Row({
  icon: Icon,
  title,
  subtitle,
  badge,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  badge?: { text: string; cls: string };
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-surface-low">
      <Icon className="w-4 h-4 text-outline flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] text-on-surface font-medium truncate">{title}</span>
          {badge && (
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider flex-shrink-0 ${badge.cls}`}>
              {badge.text}
            </span>
          )}
        </div>
        <p className="text-[12px] text-outline truncate mt-0.5">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, tone = "text-on-surface" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-surface-low">
      <div className="text-[10px] text-outline uppercase tracking-wide truncate">{label}</div>
      <div className={`text-[14px] font-semibold font-mono mt-0.5 truncate ${tone}`}>{value}</div>
    </div>
  );
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-outline font-mono text-[12px] truncate">{value}</span>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Streaming endpoint                                                  */
/* ------------------------------------------------------------------ */

/**
 * Point the engine at a playback endpoint without rebuilding the app.
 *
 * This used to be a build-time environment variable, which meant changing it
 * meant recompiling. The token is held only by the engine, and is not shown
 * back once it has been sent.
 */
function PlaybackEndpoint({
  onSubmit,
  configured,
}: {
  onSubmit: (baseUrl: string, token: string) => void;
  configured: boolean;
}) {
  const [baseUrl, setBaseUrl] = React.useState("");
  const [token, setToken] = React.useState("");

  return (
    <div className="flex flex-col gap-2.5">
      <input
        type="url"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="https://your-endpoint.example"
        aria-label="Endpoint URL"
        className="px-3.5 py-2.5 rounded-xl bg-surface-high text-[13px] text-on-surface placeholder-outline outline-none focus-visible:ring-1 focus-visible:ring-primary"
      />
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Access token"
        aria-label="Access token"
        className="px-3.5 py-2.5 rounded-xl bg-surface-high text-[13px] text-on-surface placeholder-outline outline-none focus-visible:ring-1 focus-visible:ring-primary"
      />
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => {
            onSubmit(baseUrl.trim(), token.trim());
            setToken("");
          }}
          disabled={!baseUrl.trim() || !token.trim()}
          className="px-4 py-2 rounded-full bg-primary text-on-primary text-[12px] font-semibold disabled:opacity-30"
        >
          Use this endpoint
        </button>
        <button
          type="button"
          onClick={() => {
            onSubmit("", "");
            setBaseUrl("");
            setToken("");
          }}
          className="px-4 py-2 rounded-full bg-surface-high text-[12px] font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
        >
          Clear
        </button>
        <span className="text-[11px] text-outline ml-auto">
          {configured ? "Playback available" : "Search only"}
        </span>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Backends                                                            */
/* ------------------------------------------------------------------ */

/**
 * The instances the audio engine talks to.
 *
 * This build of the engine ships with an empty instance list and no discovery
 * URL, so it falls back to a single hard-coded catalogue entry and no
 * streaming entry at all. That is why search can work while nothing plays:
 * search reaches a public metadata API, but resolving an actual stream needs a
 * streaming backend that is not there. Adding one here fixes playback.
 */
function Instances({
  onChange,
}: {
  onChange: (opts: {
    add?: { url: string; type: "api" | "streaming" }[];
    remove?: { url: string; type: "api" | "streaming" }[];
    refresh?: boolean;
  }) => void;
}) {
  const instances = usePlayerStore((s) => s.instances);
  const monoReady = usePlayerStore((s) => s.monoReady);
  const [url, setUrl] = React.useState("");
  const [kind, setKind] = React.useState<"api" | "streaming">("streaming");

  const asked = React.useRef(false);
  React.useEffect(() => {
    if (!monoReady || asked.current) return;
    asked.current = true;
    onChange({});
  }, [monoReady, onChange]);

  const streaming = [
    ...(instances?.discovered.streaming ?? []),
    ...(instances?.user.streaming ?? []),
  ];
  const catalogue = [...(instances?.discovered.api ?? []), ...(instances?.user.api ?? [])];
  const userUrls = new Set([
    ...(instances?.user.api ?? []).map((i) => i.url),
    ...(instances?.user.streaming ?? []).map((i) => i.url),
  ]);

  return (
    <div className="flex flex-col gap-3">
      {streaming.length === 0 && (
        <p className="text-[12px] text-danger leading-relaxed">
          No streaming backend. Search and artwork work without one, but nothing
          will play until you add a streaming instance below.
        </p>
      )}

      <List label="Streaming" items={streaming} userUrls={userUrls} kind="streaming" onChange={onChange} />
      <List label="Catalogue" items={catalogue} userUrls={userUrls} kind="api" onChange={onChange} />

      <div className="flex items-center gap-2 pt-1">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "api" | "streaming")}
          aria-label="Instance type"
          className="px-2.5 py-2.5 rounded-xl bg-surface-high text-[12px] text-on-surface outline-none"
        >
          <option value="streaming">Streaming</option>
          <option value="api">Catalogue</option>
        </select>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://instance.example"
          aria-label="Instance URL"
          className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-surface-high text-[13px] text-on-surface placeholder-outline outline-none focus-visible:ring-1 focus-visible:ring-primary"
        />
        <button
          type="button"
          onClick={() => {
            const trimmed = url.trim();
            if (!trimmed) return;
            onChange({ add: [{ url: trimmed, type: kind }] });
            setUrl("");
          }}
          disabled={!url.trim()}
          className="px-4 py-2.5 rounded-full bg-primary text-on-primary text-[12px] font-semibold disabled:opacity-30 flex-shrink-0"
        >
          Add
        </button>
      </div>

      <button
        type="button"
        onClick={() => onChange({ refresh: true })}
        className="self-start text-[11px] text-outline hover:text-on-surface transition-colors"
      >
        Re-check instances
      </button>
    </div>
  );
}

function List({
  label,
  items,
  userUrls,
  kind,
  onChange,
}: {
  label: string;
  items: { url: string; version?: string }[];
  userUrls: Set<string>;
  kind: "api" | "streaming";
  onChange: (opts: { remove?: { url: string; type: "api" | "streaming" }[] }) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-outline mb-1.5">
        {label}
      </p>
      {items.length === 0 ? (
        <p className="text-[12px] text-outline">None configured.</p>
      ) : (
        <div className="rounded-xl bg-surface-high/50 divide-y divide-white/5">
          {items.map((i) => (
            <div key={i.url} className="flex items-center gap-2 px-3 py-2">
              <span className="text-[12px] text-on-surface-variant truncate flex-1 font-mono">
                {i.url}
              </span>
              {userUrls.has(i.url) && (
                <button
                  type="button"
                  onClick={() => onChange({ remove: [{ url: i.url, type: kind }] })}
                  aria-label={`Remove ${i.url}`}
                  className="text-[11px] text-outline hover:text-danger transition-colors flex-shrink-0"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
