# AuralFlow: Native Lossless Music Player — Implementation Record

**Status: implemented.** This document now records what was built, not what was
proposed. Where the build diverged from the original plan, the reason is given.

AuralFlow is a native app for Windows, macOS, Linux, Android and iOS. One click
opens it with everything running.

---

## Scope change from the original plan

The original plan targeted desktop only and deferred mobile, and it described a
web-shaped UI (top header with hamburger, floating pill nav, a marketing-style
hero banner). Both were changed:

- **Mobile is in scope.** Tauri v2 mobile targets are wired up and the UI has a
  real compact layout, not a squeezed desktop one.
- **No web chrome.** There is no page header, navbar, hamburger, hero or
  footer. The only top chrome is a single native window toolbar that doubles as
  the drag region.

---

## Shell

### Regular layout — desktop windows (≥ 860px)

```
┌───────────────────────────────────────────────────────────────┐
│ Toolbar  ‹ ›   [ Search  ⌘K ]        engine · inspector · ⊟⊞✕ │ ← drag region
├──────────┬──────────────────────────┬─────────────────────────┤
│ Sidebar  │ Content                  │ Audio Engine rail       │
│ Discover │ shelves, lists, settings │ disc · telemetry ·      │
│ Library  │                          │ spectrum · queue · mood │
│ System   │                          │                         │
│ Mood     │                          │                         │
│ AI DJ    │                          │                         │
├──────────┴──────────────────────────┴─────────────────────────┤
│ Player bar  art · transport · progress · quality · volume     │
└───────────────────────────────────────────────────────────────┘
```

### Compact layout — phones and narrow windows (< 860px)

```
┌─────────────────────────┐
│ (status bar / notch)    │ ← safe-area inset
│ Content, full bleed     │
│                         │
├─────────────────────────┤
│ Mini player  ▶ ⏭        │ ← tap raises the Now Playing sheet
├─────────────────────────┤
│ Listen Search Lib Q Aud │ ← platform tab bar
│ (home indicator)        │ ← safe-area inset
└─────────────────────────┘
```

Layout is chosen by width, not platform, so a resized desktop window and a
tablet in portrait both get what fits.

---

## What was built

### Frontend

| File | Notes |
|---|---|
| `app/page.tsx` | Shell for both form factors; tab history; tray-event listener; store hydration |
| `app/globals.css` | Stitch design tokens; toolbar, sidebar, tab bar, mini player, player bar, rails |
| `app/layout.tsx` | Dark colour scheme, `viewport-fit=cover`, no user zoom |
| `components/Toolbar.tsx` | **NEW** — the only top chrome; window controls, history, search |
| `components/Sidebar.tsx` | **NEW** — sectioned nav, mood-flow meter, AI DJ status, output chip |
| `components/TabBar.tsx` | **NEW** — platform tab bar for the compact layout |
| `components/PlayerBar.tsx` | **NEW** — desktop transport |
| `components/MiniPlayer.tsx` | **NEW** — compact transport |
| `components/AudioEngineRail.tsx` | **NEW** — inspector: telemetry, spectrum, queue, mood vector |
| `components/TrackRow.tsx` | **NEW** — container-query track row shared by Search and Library |
| `components/Rail.tsx` | **NEW** — pointer-driven seek / volume slider |
| `components/SettingsTab.tsx` | **NEW** — Audio Lab, from the Stitch Audio Quality board |
| `components/{Home,Search,Library,Queue}Tab.tsx` | Rebuilt for both form factors |
| `components/NowPlayingScreen.tsx` | Art-left/controls-right on desktop; sheet on phones |
| `hooks/useFormFactor.ts` | **NEW** — regular vs compact |
| `hooks/useKeyboardShortcuts.ts` | **NEW** — transport, navigation, like, search |
| `hooks/useMonochrome.ts` | Memoized API; repeat/shuffle honoured; real mute; feedback gated on the Adaptive Flow setting |
| `lib/format.ts` | **NEW** — shared time, quality-badge and codec helpers |
| `stores/playerStore.ts` | Shuffle, repeat, mute, rail state, settings, AI stats, SSR-safe hydration |
| `next.config.ts` | Static export, unoptimized images, trailing slash |
| `eslint.config.mjs` | **NEW** — ESLint was not configured; `npm run lint` was interactive |

### Backend

| File | Notes |
|---|---|
| `api/endpoints/recommendations.py` | Added `GET /stats` |
| `services/recommendation_service.py` | Tracks training steps and last reward for `/stats` |

### Native shell

| File | Notes |
|---|---|
| `src-tauri/src/lib.rs` | Window, tray menu, single instance, window-state plugin, mobile entry point |
| `src-tauri/src/services.rs` | **NEW** — starts/stops Monochrome and the backend; adopts already-running ones |
| `src-tauri/tauri.conf.json` | 1280×820, undecorated, bundle targets, CSP |
| `src-tauri/Cargo.toml` | Library crate for mobile; desktop-only plugins behind a cfg |
| `src-tauri/capabilities/default.json` | **NEW** — Tauri v2 permissions |
| `src-tauri/icons/*` | **NEW** — generated PNG/ICO/ICNS set |
| `desktop/package.json` | **NEW** — desktop and mobile build scripts |
| `start.py` | Preflight checks, port adoption, health checks, clear failure messages |

---

## Design synthesis — which board each element comes from

All 25 boards in `stitch_design_system/` were reviewed and mixed. Board
placeholders with no real backing (play counts, "42.4 GB offline", named DAC
hardware, verified ticks, follower counts) are **not** fabricated — each row is
bound to real session state or omitted.

| Element | Board |
|---|---|
| Colour ramp, type scale, spacing tokens | `desktop_audiophile_lossless_workstation` |
| Sidebar sections, brand lockup, footer status card | `desktop_audiophile_lossless_workstation` |
| Window toolbar: chevrons, search, ⌘K, engine chip | `desktop_audiophile_lossless_workstation` |
| Bitstream telemetry 2×2, 10-band spectrum, HRTF toggle | `desktop_audiophile_lossless_workstation` |
| Three-zone player bar, equalizer glyph on active row | `desktop_audiophile_lossless_workstation` |
| Waveform strip, control pod, oversized time watermark | `now_playing_vision_v2*` |
| Ambient radial glows, shader backdrop | `home_vision_v2_shader_*` |
| Now Playing card + drag-handle queue | `queue_vision_v2` |
| Audio Quality tiers, Atmos / head-tracking rows | `settings_vision_v2` |
| Eyebrow chip row + in-card stream telemetry strip | `native_listen_now` |
| Section subtitles + "See All ›", Spatial Immersion card, output card | `native_listen_now` |
| Grouped inset list, "Find in Library", stacked badges, cloud card | `native_library` |
| Circular artist avatars, per-row overflow | `library_vision_v2`, `library` |
| Recent chips with clock icon; Explore genre mosaic | `search_vision_v2` |
| **Album screen**: centred hero, quality pills, Play/Shuffle pair, tracklist + duration column, format card | `native_album_details`, `album_view_vision_v2` |
| **Artist screen**: full-bleed hero, Play/Follow, Frequencies, Discography | `artist_profile_vision_v2` |
| Output destination pill, tick scrubber, inline codec spec, Lyrics/device/queue trio | `native_now_playing` |
| Compact screen titles, mini-player cast button | `native_*` family |

New files from this pass: `AlbumScreen.tsx`, `ArtistScreen.tsx`,
`ExploreMosaic.tsx`, `SectionHeading.tsx`, `lib/catalogue.ts`.

Albums and artists are **derived** by grouping the tracks the session has seen
(`lib/catalogue.ts`), since the catalogue returns tracks rather than releases.

## Removing the placeholders

The UI originally drew several values it did not have. Each was replaced at the
source rather than restyled.

| Was | Now |
|---|---|
| `monochrome_app/` missing entirely | Monochrome 2.5.1 vendored, with `js/auralflow-bridge.js` written against its real `Player` / `MusicAPI` / `audioContextManager` singletons |
| Spectrum was a random walk labelled "Motion · DSP bypass" | Real FFT: the bridge reads the engine's shared `AnalyserNode` at 15 fps and maps bins onto the ten display bands. Labelled "Live FFT" / "Silent" |
| Now Playing waveform was `Math.sin` noise seeded by track id | Measured envelope: the bridge sends window RMS + position; the shell keeps the loudest reading per slice. Unheard slices render at a resting height rather than inventing a level |
| `streamBitrate()` returned "9,216 kbps" guessed from the tier | Deleted. Codec / bit depth / sample rate now come from `player.currentStreamInfo`; the helpers return `null` before a stream resolves so the UI shows a dash |
| Streaming Quality setting was stored and ignored | Mapped onto `player.setQuality()` |
| Spatial toggle was stored and ignored | Mapped onto `audioContextManager.toggleBinaural()` |
| `confidence` (raw Q-value) rendered as a percentage — showed "-8%" on an untrained agent | Backend now also returns `match`, a bounded 0..1 mood affinity (`1 - distance/sqrt(5)`). The Q-value still ranks; `match` is what the UI shows |
| `torch==2.9.0` pulled the ~900 MB CUDA wheel | CPU-only build documented and used — 184 MB, and the agent is a CPU-trained MLP |

Values with no real source (play counts, "42.4 GB offline", named DAC hardware,
verified ticks) are omitted rather than invented.

### Follow-up pass: the gaps found by auditing

| Was | Now |
|---|---|
| Agent forgot everything on restart — `save_model`/`load_model` were never called | Atomic checkpoints to `ml/models/music_rl_agent.pt`: weights, optimizer, ε, lifetime step count and a bounded replay slice. Loaded on startup, written every 5 feedback events and on shutdown. **Verified**: 40 events → 9 steps, ε 0.287 → restart → all restored |
| Play history vanished on restart, so Library/Album/Artist were always empty | `recentlyPlayed` persists to localStorage (50 tracks), with a Clear control in Settings |
| `aiStats.lastReward` polled every 15s and never displayed | Shown in the AI DJ card, coloured by sign |
| Store held `queue` / `queueIndex` that nothing read | Removed — the queue lives in the engine |
| `sessions.py` had five `user_id: int = 1  # TODO: Get from JWT auth` | Replaced with a `LOCAL_USER_ID` constant and module docs stating the single-user design, and that the UI does not call these endpoints |
| No tests anywhere, against AGENTS.md | 12 pytest specs covering scoring bounds, mood mapping, checkpoint round-trip, corrupt/missing checkpoints and reward ordering |
| `@app.on_event` deprecation warnings | Migrated to a lifespan context manager |
| Repeat/shuffle drove only the shell's own `advance()`, never the engine's `repeatMode` — so repeat-all did not wrap | Handed to the engine via `af:repeat` / `af:shuffle`; the shell mirrors its state onto it |

## Bugs found and fixed during the build

1. **Every Tailwind padding and margin utility was dead.** The global `*`
   reset was unlayered, so it beat Tailwind's `utilities` layer — `p-3`
   computed to `0px` app-wide. Moved the reset into `@layer base`. This was a
   pre-existing bug, not one introduced here.
2. **Track-list columns collapsed.** The grid used viewport breakpoints while
   sitting in a narrow container beside the inspector, so the title column
   shrank to zero and text overlapped. Rebuilt as `TrackRow` driven by
   container queries.
3. **Hydration mismatch.** The store read `localStorage` at module creation, so
   server and client first renders disagreed once anything was liked. Moved to
   a `hydrate()` action called after mount.
4. **Artwork overflowed the Now Playing sheet on phones**, painting over the
   title. Sized from whichever axis runs out first.
5. **Mood meter clipped** by a fixed row height smaller than its contents.
6. **Services that died on startup became zombies.** `spawn()` kept each child
   but only reaped it at shutdown, so a service that exited immediately — a
   missing `uvicorn`, a port clash — sat `<defunct>` for the life of the app
   and said nothing about why. Found by inspecting the running process tree.
   Added a reaper thread that collects exit statuses and reports them
   (`backend exited (exit status: 1) — that feature is unavailable this
   session`), so the failure is visible instead of silent.

---

## Verification

### Automated

```bash
cd frontend && npm run lint && npm run type-check && npm run build
cd backend && venv/bin/python -m pytest
cd desktop/src-tauri && cargo check
```

All pass: lint and types clean, static export emits to `frontend/out`, 12
backend tests green, and the Rust crate compiles with no warnings.

### The UI

Checked in a browser at 1440×900 and 390×844 by driving the real Monochrome
`postMessage` protocol with sample tracks: shelves, search, library, queue,
settings, Now Playing, the inspector rail, the mini player and the tab bar all
render and respond correctly. Console clean apart from the expected connection
failures for services that were not running.

### The native app

Built and run on Linux/Wayland (Hyprland):

- Launches as a real native window — no browser chrome, custom toolbar and
  window controls working, `decorations: false` honoured.
- The inspector rail auto-collapsed at a 933px window width, as designed.
- Project-root detection walked up from the executable and found the checkout.
- The tray icon was created (`libayatana-appindicator` loaded).
- With both services absent the app opened anyway and reported each one
  precisely, rather than failing to start:

  ```
  [auralflow] project root: /home/anonymouse/Downloads/AuralFlow
  [auralflow] monochrome_app not found at …/monochrome_app — audio engine unavailable
  [auralflow] started backend (pid 19045)
  [auralflow] backend exited (exit status: 1) — that feature is unavailable this session
  ```

- Shut down leaving no orphaned or zombie processes.

### Live services

All three ran together on this machine:

```
Monochrome (vite)  :5173   real catalogue, real track metadata
Backend (uvicorn)  :8000   /health, /stats, /mood, /score all answering
Frontend (next)    :3000   sidebar shows "AI DJ ONLINE"
```

Searching returned **real tracks** from the live catalogue (for example
"Lossless" by Oleyan, `apple:track:1628959676`, 3:21), and the RL agent scored
them for real — a genuine PyTorch forward pass producing mood vectors, mood
distances and Q-values. An electronic track against an electronic mood vector
scores distance 0.000 / 100% match; an ambient one scores 1.281 / 43%.

### Audio playback: removed from the upstream build

**No audio plays, and this is not a temporary outage.** Monochrome's public
source ships with its playback service disabled:

```js
// monochrome_app/js/storage.js — upstream
export const unifiedPlaybackSettings = {
    DEFAULT_API_BASE_URL: '',
    DEFAULT_API_TOKEN: '',
    isEnabled() { return false; },
```

`fetchUnifiedPlaybackEnvelope()` returns null on that flag before making any
request, which is why no stream call is ever attempted and no error surfaces.
The "Playback's down for maintenance" banner is hard-coded in their
`index.html`, not a live status check.

Search, metadata, artwork and quality tiers all work — only streaming is gone.

**What was done about it.** The vendored fork now honours Monochrome's own
`unified-playback-enabled` / base-URL / token settings instead of ignoring
them, and AuralFlow passes `NEXT_PUBLIC_PLAYBACK_API_BASE` /
`NEXT_PUBLIC_PLAYBACK_API_TOKEN` through to the engine on connect. Supply an
endpoint you are entitled to use and playback turns on; leave them unset and
the app says "Playback unavailable — no streaming endpoint configured" rather
than silently doing nothing.

Two features therefore remain **wired but unobserved**: the real FFT spectrum
and the measured waveform have never received a frame, and `streamInfo` stays
null so the telemetry card shows dashes.

### Still not verified

- **Android and iOS builds.** The targets are configured but `tauri android
  init` / `tauri ios init` need Android Studio and Xcode respectively.
- **Packaged installers.** `cargo check` passes; `npm run build` in `desktop/`
  has not been run, so the bundle step is unexercised.

---

## Pass 3: the DJ gets its eyes and hands

The brain (network, rewards, training loop) matched the original idea; the
eyes (real mood data) and hands (finding songs, queuing them) did not. This
pass restored the loop with parts AuralFlow owns itself. Full description in
`AURALFLOW.md`.

| Was | Now |
|---|---|
| Mood from a genre lookup, blank without a genre; `compute_mood_vector` waiting for Spotify features nobody sends | The bridge measures the playing track from the live analyser — loudness, crest, dynamic range, centroid, flatness, flux, band ratios, peak-based chroma, onset-autocorrelation tempo, Krumhansl key/mode — and `feature_service` maps it to the 5-D vector with a confidence that grows with seconds heard. Artist priors cover unheard tracks by measured artists; genre is the last resort; "unknown" is reported as such. |
| Candidates were whatever was typed into search | A `Song` library: every search result, play, import, album and artist lookup, with plays, skips, likes and rewards. `/library/pool` is what the DJ chooses from. |
| `predict_next_mood` only overwrote a display value | Session arcs (`dj_service.arc_target`) turn the current mood into a target; the target is part of the agent's state (17 dims now; checkpoints carry the layout and mismatches start fresh). |
| No auto-queue; every experience stored as terminal, so the Bellman bootstrap never ran | `/dj/next` picks from the pool (policy blended with target fit, novelty, recency, diversity; exploration labelled as discovery), the shell queues it as play-next, and feedback carries `next_state` and the next track's mood so the update is SARSA-style. Rejecting a pick is a −0.5 reward. |
| Headphone correction and the stabiliser fought over the same filters | Sound Signature layers — manual base, device (AutoEQ, matched by output-device name, per-device profile), track (stabiliser), loudness (volume-dependent) — summed through `applyTransientGains`. Output devices enumerated, `devicechange` handled, `setSinkId` where allowed, manual naming where not. |
| Engine handshake was a single `ready` at boot | The shell says `hello` until the engine answers, so a fast engine boot or a shell reload still connects. |
| `end_session` raised `NameError` when the user was missing; alembic env carried a `/Users/anonymouse` path; `DATABASE_URL` was ignored; unused Postgres/Spotify deps | Fixed; `ensure_schema()` adds new columns to an existing SQLite file so upgrades need no migration step. |

Verification: 50 backend specs, ESLint and `tsc` clean, static export builds,
`engine/test/selftest.mjs` passes (tempo 120 ± 6, key C, major, layer sums),
and a Playwright run against the built UI with a stub engine speaking the
`af:` protocol and the live backend: search → library → play → measured
features → pick queued next → rejection → feedback with the real next
transition, with no console errors.
