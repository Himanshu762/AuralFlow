# AuralFlow — System Documentation

> A lossless music player with a DJ that listens. Every track's mood is
> measured from the audio as it plays, the library becomes the DJ's candidate
> pool, and a reinforcement-learning policy picks what follows along an arc
> you choose. One correction — for the device, the record and the volume —
> shapes the sound on top of your own EQ.

This document describes the system as built. `README.md` is the overview and
quick start; `implementation_plan.md` is the record of what changed and why.

---

## 1. The idea

The original AuralFlow loop was:

1. read each track's mood from real audio features,
2. predict where the listener's mood is heading,
3. find candidates that match that prediction,
4. rank them with the RL policy,
5. queue the top pick automatically.

Spotify's audio-features and recommendation endpoints disappeared, and the
move to Monochrome gave playback but no mood data and no "find me songs like
this" call. For a while the agent was a re-sorter for search results. The
current build restores the loop with parts AuralFlow owns itself:

| Step | How it works now |
|---|---|
| Mood from audio | The engine bridge measures the playing track from the live analyser: loudness, dynamics, spectral shape, tempo, major/minor, vocal-band energy. The backend maps that to the 5-D vector and caches it per track. |
| Predict the mood | A session **arc** (hold, drift, lift, settle, focus, custom) turns the current mood into a target for the next track. |
| Candidates | The **library**: every track the shell has seen (searches, plays, imports, album and artist lookups), with its measured mood, play history and likes. |
| Rank | The policy's Q-value blended with fit to the target mood, plus novelty, recency and diversity terms. The policy's share grows as it trains. |
| Queue | The pick is sent to the engine as "play next". The listener can play it now, or reject it — which is a training signal. |

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Tauri shell (desktop) — window, tray, starts the two services    │
│                                                                  │
│  ┌── Next.js UI ─────────────────────┐   ┌── Monochrome ───────┐ │
│  │ Flow card · Mood meter · Library  │   │ hidden iframe       │ │
│  │ Sound Signature · Queue · EQ      │◄─►│ + auralflow-bridge  │ │
│  │ hooks/useMonochrome = the DJ loop │pm │ analyser → features │ │
│  └───────────────┬───────────────────┘   │ layers → EQ filters │ │
│                  │ HTTP                   │ devices, sinkId     │ │
│                  ▼                        └─────────────────────┘ │
│  ┌── FastAPI backend ────────────────────────────────────────┐   │
│  │ /library   tracks, measured features, plays, likes, pool  │   │
│  │ /dj        next pick along the arc, reject, modes         │   │
│  │ /recommendations  score a list, feedback, one track's mood│   │
│  │ SQLite · PyTorch Q-network (ml/agents) · checkpoints      │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

Four layers:

- **Shell** (`desktop/src-tauri`): serves the bundled engine over localhost,
  spawns the backend from its virtualenv, owns the window and tray.
- **UI** (`frontend/`): static Next.js export; Zustand store; one hook
  (`useMonochrome`) that speaks to the engine and runs the DJ loop.
- **Engine bridge** (`engine/auralflow-bridge.js`): grafted into the vendored
  Monochrome tree; translates `af:*` messages, measures audio, composes the
  EQ layers, tracks output devices.
- **Backend + ML** (`backend/`, `ml/`): library, DJ, agent, persistence.

---

## 3. The DJ loop, step by step

Every time a track starts (`af:trackloaded`):

1. **Mood of the new track.** `POST /recommendations/mood` returns the best
   reading the library has: measured, artist prior, genre, or unknown.
   The store's `currentMood` and `recentMoods` update.
2. **Feedback for the previous track.** Play duration, skip, like — plus the
   *next state* and the next track's mood, so the agent's target bootstraps
   from the transition the listener actually took (SARSA-style).
3. **Ask the DJ.** `POST /dj/next` with the mood, the arc, and what is already
   about to play. The DJ returns a pick, runners-up, the arc target and a
   reason in plain language.
4. **Queue it.** If auto-queue is on, `af:queueadd {next: true}`.
5. **While it plays**, `af:features` arrives every 3 s; the shell posts it to
   `/library/features`, and once enough audio has been heard the mood
   reading switches from the genre tag to the measurement.

Rejecting a pick posts `/dj/reject` (reward −0.5) and asks again.

### Arcs

| Mode | Target for the next track |
|---|---|
| hold | mean of the last few moods and the current one |
| drift | recency-weighted average plus momentum of the last transition |
| lift | current + (+0.10 energy, +0.06 valence, +0.05 dance, −0.03 acoustic, −0.02 instrumental) |
| settle | current + (−0.10, +0.02, −0.06, +0.06, +0.04) |
| focus | 35 % of the way toward [0.45, 0.50, 0.35, 0.55, 0.80] |
| custom | linear path from the current mood to a listener-set vector over N tracks |

### Ranking

For each candidate in the pool (minus the playing track, the next two queued,
recent plays and rejections):

```
score = w_q · sigmoid(z(Q))  +  (1 − w_q) · fit · (0.7 + 0.3·confidence)  + bonuses
fit   = 1 − |mood − target| / √5           (0.3 when the mood is unknown)
w_q   = min(0.55, 0.08 + training_steps / 400)
bonuses: +0.06 never played · +0.05 liked · +0.10·mean reward
         −0.08 same artist as now · −0.08·skip ratio · up to −0.25 played in the last 2 h
```

With probability ε the DJ explores instead: a random pick from the top eight,
preferring tracks whose mood has not been measured yet. The response says so,
and the UI labels it a *Discovery*.

---

## 4. Measuring mood from audio

The bridge runs one 30 Hz analysis tick off the engine's shared
`AnalyserNode` while audio plays. Per frame it reads the byte FFT and the
time-domain window and accumulates:

| Measurement | How |
|---|---|
| loudness (dBFS), peak, crest factor | time-domain RMS and peak |
| dynamic range | p95 − p10 of frame loudness |
| spectral centroid, rolloff (85 %), flatness | from the linear-magnitude spectrum |
| spectral flux | positive change since the previous frame, normalised |
| band ratios | energy below 150 Hz, 300–3400 Hz (vocal band), above 4 kHz |
| chroma | energy per pitch class from spectral *peaks* only, so drums and noise do not swamp it |
| tempo, beat strength | autocorrelation of the flux series over 60–200 BPM, parabolic refinement, octave choice nearest ~115 BPM |
| key, major/minor | Krumhansl–Kessler profiles correlated against the chroma |

`backend/app/services/feature_service.py` maps these onto the vector:

- **energy** ← loudness, flux, brightness, tempo
- **valence** ← major mode, tempo, brightness (a proxy, and labelled as one)
- **danceability** ← beat strength, tempo near 118 BPM, low-end share
- **acousticness** ← low flatness, high crest factor, dynamic range, little top end
- **instrumentalness** ← inverse of steady *and modulated* vocal-band energy

Confidence is `seconds / 45`, capped at 1; readings under 0.3 are stored but
not trusted, and the library falls back to an artist prior or the genre tag.
A fuller measurement is never overwritten by a shorter later one.

`node engine/test/selftest.mjs` drives the analyser with a synthetic 120 BPM
C-major signal and checks tempo, key, mode and the EQ layer arithmetic.

---

## 5. Sound Signature

The equaliser is layered. The listener's own bands are the base; three
automatic layers stack on top, summed, clamped to ±12 dB and pushed to the
running filters through `applyTransientGains`, which never writes to the
engine's storage:

| Layer | Source | Persistence |
|---|---|---|
| device | AutoEQ correction matched to the output device's name, or chosen by hand | per device, in `localStorage` |
| track | the adaptive stabiliser's live correction toward the listener's long-term balance | none (recomputed) |
| loudness | equal-loudness compensation growing as volume drops (bass shelf up to +9 dB, treble up to +3 dB) | preference only |

Output devices come from `navigator.mediaDevices.enumerateDevices()`; the
`devicechange` event re-resolves the profile, and `setSinkId` switches the
output where the platform allows. Where the platform hides device names, the
listener can name the device and the AutoEQ match runs on that. Auto-matching
only trusts a match where every distinctive token of the device name appears
in the AutoEQ entry's name.

---

## 6. Data

**SQLite** at `backend/auralflow.db` (or `DATABASE_URL`). `ensure_schema()`
creates tables and adds any column a model has gained since, so upgrades need
no migration step.

### songs — the library

| Column | Meaning |
|---|---|
| track_id, name, artist, artist_id, album, album_id, genre, duration_ms, cover, cover_large, audio_quality, audio_modes | catalogue metadata |
| source, first_seen_at | where the track came from |
| energy … instrumentalness, mood_vector, mood_source, mood_confidence | the mood and its provenance (`measured` / `artist` / `genre` / `unknown`) |
| features, analysis_seconds, analysed_at | the raw measurement |
| play_count, skip_count, liked, last_played_at, reward_total, reward_count | listening history |

`users`, `sessions` and `transitions` remain for session analytics; the UI does
not call the sessions endpoints.

### Agent checkpoint

`ml/models/music_rl_agent.pt` (override with `AURALFLOW_MODEL_PATH`): weights,
optimiser, ε, lifetime step count, a bounded replay slice, and the state
layout. A checkpoint with a different layout is ignored and the agent starts
fresh. Written every five feedback events and on shutdown.

---

## 7. API

Base URL `http://localhost:8000/api/v1`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/library/tracks` | upsert tracks `{tracks, source}` |
| POST | `/library/features` | store a measurement `{track_id, seconds, features, final}` → the resolved mood |
| POST | `/library/event` | `play`, `like`, `unlike` |
| GET | `/library/pool` | the candidate pool with moods and history |
| GET | `/library/stats` | counts by mood source |
| POST | `/dj/next` | the pick, runners-up, target, reason |
| POST | `/dj/reject` | a rejected pick (reward −0.5) |
| GET | `/dj/modes` | arc modes, policy weight, exploration |
| POST | `/recommendations/score` | rank a list the shell hands over |
| POST | `/recommendations/feedback` | feedback with optional `next_state` and `next_song_mood_vector` |
| POST | `/recommendations/mood` | one track's mood, source, confidence and measured summary |
| GET | `/recommendations/stats` | exploration rate, replay size, steps, last reward |

---

## 8. The agent

`ml/agents/music_rl_agent.py`. State (17): current mood (5), mean of recent
moods (5), arc target (5), time of day (1), device (1). Action (5): the
candidate's mood. Q-network: 22 → 128 → 128 → 64 → 1 with dropout, scored in
eval mode so a score is reproducible.

Rewards: +1 liked or replayed, +0.5 played fully, +0.2..0.5 partial, −0.3
skipped mid-song, −1 skipped early, −0.5 rejected before playing.

Training: experience replay, batch 32, Adam 1e-3, γ 0.95, ε from 0.3 decaying
by 0.995 per step to 0.05. Targets bootstrap from the *next action actually
taken* when the following track is known.

---

## 9. Running and testing

```bash
cd desktop && npm run dev                 # the app, services included
python3 start.py                          # browser mode with health checks

cd backend && venv/bin/python -m pytest   # 50 specs: agent, features, library, DJ, API
cd frontend && npm run lint && npm run type-check && npm run build
node engine/test/selftest.mjs             # bridge analysis + signature arithmetic
```

## 10. Known limitations

| Area | Limitation |
|---|---|
| Valence | A proxy from mode, tempo and brightness; it is labelled as measured but it is not a listener rating. |
| Vocal detection | Band-energy modulation, not a source separator; instrumental tracks with busy midrange can read as vocal. |
| Unheard tracks | Mood comes from an artist prior or genre until the track has played ~45 s. Discovery picks exist to fill those in. |
| Output devices | Browsers withhold device names until a media permission is granted; some webviews expose no output list at all. Naming the device by hand covers both. |
| Cold start | Until ~400 training steps the arc's target dominates the policy, by design. |
| Mobile | Phones run the UI only; the engine and backend live on a machine on the LAN. |
