/**
 * AuralFlow bridge.
 *
 * Monochrome runs inside a hidden iframe in the AuralFlow shell. This module
 * translates between AuralFlow's `af:` postMessage protocol and Monochrome's
 * Player / MusicAPI singletons, and streams real playback telemetry — including
 * live FFT data from the shared AnalyserNode — back to the parent window.
 *
 * Nothing here is simulated: every value sent to the parent is read from the
 * running audio graph or from the track metadata the API returned.
 */

import { Player } from './player.js';
import { LyricsManager } from './lyrics.js';
import { downloadTrackWithMetadata, downloadTracks } from './download-service.js';
import { runAutoEqAlgorithm } from './autoeq-engine.js';
import { TARGETS } from './autoeq-data.js';
import { fetchAutoEqIndex, fetchHeadphoneData, searchHeadphones, POPULAR_HEADPHONES } from './autoeq-importer.js';
import { getPresetsForBandCount } from './equalizer.js';
import { REPEAT_MODE } from './utils.js';
import { MusicAPI } from './music-api.js';
import { audioContextManager } from './audio-context.js';
import {
    unifiedPlaybackSettings,
    deezerFallbackSettings,
    preferDolbyAtmosSettings,
    downloadQualitySettings,
    apiSettings,
} from './storage.js';
import { parseDynamicCSV, parseJSPF, parseXSPF, parseXML, parseM3U } from './playlist-importer.js';

const TIMEUPDATE_MS = 250;
const SPECTRUM_FPS = 15;

/* The ten bands AuralFlow's spectrum widget draws, in Hz. */
const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/**
 * Whether the engine can actually resolve a stream.
 *
 * Two independent paths can serve audio: a unified playback endpoint the user
 * configures, and the ISRC-based fallback that ships enabled. Reporting only
 * the first told the shell "playback unavailable" while the fallback was
 * happily playing music, so ask both.
 */
function settingEnabled(settings) {
    try {
        return Boolean(settings?.isEnabled());
    } catch {
        return false;
    }
}

/**
 * Ask a backend whether it is actually answering.
 *
 * Being configured is not the same as working. The engine reaches its
 * catalogue and streams through an instance; if that instance is down there
 * is nothing to play, and saying "playback available" would be a lie the user
 * only discovers by pressing play.
 */
async function hostResponds(base) {
    if (!base) return false;
    try {
        const res = await fetch(String(base).replace(/\/+$/, '') + '/', {
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return false;
        /* The Deezer fallback reports its own health; an exhausted pool is
           reachable but useless. Other backends just answer. */
        const text = await res.text();
        try {
            const body = JSON.parse(text);
            if (body?.ok === false) return false;
            const available = body?.accounts?.available;
            if (available !== undefined) return Number(available) > 0;
        } catch {
            /* not JSON — a plain 200 is good enough */
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Whether the engine can actually resolve a stream.
 *
 * A configured unified endpoint is taken at its word. Otherwise the catalogue
 * instance the engine resolved is what serves audio, so ask that; the older
 * ISRC fallback is tried last.
 */
async function playbackAvailable() {
    if (settingEnabled(unifiedPlaybackSettings)) return true;

    try {
        const instances = await apiSettings.loadInstancesFromGitHub();
        const first = (instances?.api ?? [])[0];
        const url = typeof first === 'string' ? first : first?.url;
        if (await hostResponds(url)) return true;
    } catch {
        /* fall through to the older path */
    }

    if (!settingEnabled(deezerFallbackSettings)) return false;
    try {
        return await hostResponds(deezerFallbackSettings.getApiBaseUrl());
    } catch {
        return false;
    }
}

let player = null;
let api = null;
let lastState = null;
let spectrumTimer = null;

/**
 * Full track objects from the last search, keyed by id.
 *
 * The shell only ever sees serialized tracks, but the player needs the real
 * objects to resolve a stream. Caching them here means starting playback costs
 * no extra network round trips.
 */
const trackCache = new Map();

/**
 * Tracks the shell holds on to beyond a single search — imported playlists,
 * and anything else it can play later. `trackCache` is cleared on every
 * search, which is right for search results but would throw away an imported
 * library the moment the user looked something up.
 */
const libraryCache = new Map();

/** Remember a resolved track so playing it later costs no round trip. */
function remember(cache, item) {
    if (item?.id != null) cache.set(String(item.id), item);
}

/* ------------------------------------------------------------------ */
/* Messaging                                                          */
/* ------------------------------------------------------------------ */

function send(type, payload = {}) {
    // The shell is the only parent; it validates the `af:` prefix on receipt.
    window.parent?.postMessage({ type: `af:${type}`, ...payload }, '*');
}

/* ------------------------------------------------------------------ */
/* Track serialization                                                */
/* ------------------------------------------------------------------ */

function coverUrl(track, size) {
    const id = track?.album?.cover ?? track?.cover ?? track?.picture ?? null;
    if (!id) return '';
    /* Apple entities carry a ready-made URL rather than an artwork id, and
       feeding one to getCoverUrl would mangle it. */
    const direct = String(id);
    if (direct.startsWith('http')) {
        return direct.replace(/\{w\}x\{h\}/, `${size}x${size}`);
    }
    try {
        return api?.getAPI?.()?.getCoverUrl?.(id, String(size)) ?? '';
    } catch {
        return '';
    }
}

/* ------------------------------------------------------------------ */
/* Apple Music library XML                                             */
/* ------------------------------------------------------------------ */

/**
 * Apple exports its library as a property list, which is a different shape
 * from the playlist XML the engine's parser understands: values are
 * `<key>Name</key><string>…</string>` pairs inside `<dict>` rather than
 * `<track>` elements with named children. Feeding a plist to that parser finds
 * nothing at all — no error, just an empty import.
 *
 * Rather than teach that parser a second grammar, translate the plist into the
 * CSV shape the importer already handles best. That path has the playlist
 * grouping and the ISRC-aware matching, so Apple libraries come across with
 * their playlists intact.
 */

/** Read one `<dict>` into a plain object. Only the value types a library uses. */
function plistDict(node) {
    const out = {};
    const children = Array.from(node.children);
    for (let i = 0; i < children.length; i++) {
        if (children[i].tagName !== 'key') continue;
        const key = children[i].textContent ?? '';
        const value = children[i + 1];
        if (!value) continue;
        i++;
        switch (value.tagName) {
            case 'string':
            case 'date':
                out[key] = value.textContent ?? '';
                break;
            case 'integer':
            case 'real':
                out[key] = Number(value.textContent) || 0;
                break;
            case 'true':
                out[key] = true;
                break;
            case 'false':
                out[key] = false;
                break;
            case 'dict':
                out[key] = plistDict(value);
                break;
            case 'array':
                out[key] = Array.from(value.children).map((child) =>
                    child.tagName === 'dict' ? plistDict(child) : (child.textContent ?? '')
                );
                break;
            default:
                out[key] = value.textContent ?? '';
        }
    }
    return out;
}

function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/**
 * Turn an Apple library plist into importable CSV.
 *
 * @returns CSV text, or null when this is not an Apple library.
 */
function appleLibraryToCsv(xmlText) {
    let doc;
    try {
        doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    } catch {
        return null;
    }
    if (doc.querySelector('parsererror')) return null;

    const root = doc.querySelector('plist > dict');
    if (!root) return null;

    const library = plistDict(root);
    const tracks = library.Tracks;
    if (!tracks || typeof tracks !== 'object') return null;

    /* Which playlists each track belongs to. A track in several appears once
       per playlist, which is how the importer groups them. */
    const membership = new Map();
    for (const playlist of Array.isArray(library.Playlists) ? library.Playlists : []) {
        const name = String(playlist?.Name ?? '').trim();
        /* Skip Apple's own generated lists — they are views, not playlists. */
        if (!name || playlist?.['Distinguished Kind'] !== undefined || playlist?.Master) continue;
        for (const item of Array.isArray(playlist['Playlist Items']) ? playlist['Playlist Items'] : []) {
            const id = String(item?.['Track ID'] ?? '');
            if (!id) continue;
            if (!membership.has(id)) membership.set(id, []);
            membership.get(id).push(name);
        }
    }

    const rows = [['Track Name', 'Artist Name', 'Album', 'Playlist Name'].map(csvCell).join(',')];
    let count = 0;

    for (const [id, track] of Object.entries(tracks)) {
        const title = String(track?.Name ?? '').trim();
        if (!title) continue;
        const artist = String(track?.Artist ?? track?.['Album Artist'] ?? '').trim();
        const album = String(track?.Album ?? '').trim();
        const lists = membership.get(String(track?.['Track ID'] ?? id)) ?? [''];
        for (const list of lists) {
            rows.push([title, artist, album, list].map(csvCell).join(','));
            count++;
        }
    }

    return count > 0 ? rows.join('\n') : null;
}

/**
 * Make an XML export safe to hand to the engine's parser.
 *
 * That parser refuses anything containing a DOCTYPE, as protection against
 * XXE. Reasonable in general, but Apple Music's exported library always opens
 * with the standard plist DOCTYPE, so every Apple export was rejected — the
 * one format we tell people to use for Apple Music.
 *
 * The actual attack vector is an ENTITY declaration: external ones fetch
 * files, internal ones expand exponentially. A DOCTYPE carrying none of those
 * is inert, and browser DOM parsers do not resolve external entities anyway.
 * So refuse entities, and drop an otherwise-harmless DOCTYPE rather than
 * refusing the document.
 *
 * @returns the cleaned text, or null when the document should be refused
 */
function sanitizeXml(text) {
    if (/<!ENTITY/i.test(text)) return null;

    /* A DOCTYPE either ends at the first ">" or, when it carries an internal
       subset, after the closing "]". Handle both rather than regexing across
       a "]>" and eating real markup. */
    return text.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/gi, '');
}

function serializeTrack(raw) {
    /* Queue entries are sometimes wrapped as { track: {...} } (that is the
       shape the saved-queue state uses), so unwrap before reading fields. */
    const track = raw?.track ?? raw;

    /* A restored queue can leave behind a stub with no id or title. Treat that
       as "nothing playing" rather than surfacing "Unknown Title" in the shell. */
    if (!track) return null;
    const id = track.id != null ? String(track.id) : '';
    if (!id && !track.title) return null;
    return {
        id,
        title: track.title ?? 'Unknown Title',
        artist: track.artist?.name || track.artists?.[0]?.name || 'Unknown Artist',
        album: track.album?.title ?? '',
        albumId: track.album?.id != null ? String(track.album.id) : null,
        artistId: (() => {
            const id = track.artist?.id ?? track.artists?.[0]?.id;
            return id != null ? String(id) : null;
        })(),
        duration: Number(track.duration) || 0,
        cover: coverUrl(track, 320),
        coverLarge: coverUrl(track, 640),
        audioQuality: track.audioQuality ?? '',
        audioModes: Array.isArray(track.audioModes) ? track.audioModes : [],
        genre: track.genre ?? '',
        trackNumber: Number(track.trackNumber) || 0,
        isUnavailable: Boolean(track.isUnavailable),
    };
}

/**
 * Real stream facts for the track that is actually playing, read off the
 * player once it has resolved a stream. Absent until playback starts.
 */
function serializeStreamInfo() {
    const info = player?.currentStreamInfo;
    if (!info) return null;
    return {
        codec: info.codec ?? null,
        quality: info.quality ?? null,
        bitDepth: info.bitDepth ?? null,
        sampleRate: info.sampleRate ?? null,
        provider: info.provider ?? player?.currentStreamProvider ?? null,
        mimeType: info.manifestMimeType ?? info.mimeType ?? null,
    };
}

/* ------------------------------------------------------------------ */
/* Playback state                                                     */
/* ------------------------------------------------------------------ */

function currentElement() {
    return player?.activeElement ?? null;
}

function emitTimeUpdate() {
    const el = currentElement();
    if (!el) return;
    send('timeupdate', {
        currentTime: Number(el.currentTime) || 0,
        duration: Number(el.duration) || Number(player?.currentTrack?.duration) || 0,
        paused: el.paused,
    });
}

function emitState(state) {
    if (state === lastState) return;
    lastState = state;
    send('statechange', { state });
}

function emitTrackLoaded() {
    const track = serializeTrack(player?.currentTrack);
    if (!track) return;
    /* A new record gets measured on its own terms, not the last one's. */
    resetAdaptive();
    /* The position in the queue moved, so the shell's view of it is stale. */
    try {
        send('queue', readQueue());
    } catch {
        /* the queue is not readable yet; the shell will ask for it */
    }
    send('trackloaded', {
        track,
        duration: Number(currentElement()?.duration) || track.duration,
        streamInfo: serializeStreamInfo(),
    });
}

/* ------------------------------------------------------------------ */
/* Adaptive EQ — keeps tonal balance steady across a mixed library     */
/* ------------------------------------------------------------------ */

/*
 * Records differ wildly in tonal balance: a 1970s master is dull beside a
 * modern one, and a loudness-war remaster is harsh beside both. On shuffle
 * that means reaching for the volume, or the EQ, every few tracks.
 *
 * This measures what is coming out of the analyser and nudges each record
 * toward the balance of everything else the listener plays — so the *balance*
 * stays put while the music still sounds like itself.
 *
 * It costs almost nothing: the FFT is already being read for the spectrum
 * display, so each update is a handful of averages over data we have.
 *
 * Four things keep it from becoming an effect in its own right:
 *
 *  - The target is the listener's own long-term balance, not a flat curve.
 *    A record already in line with their library is left completely alone.
 *    Aiming at flat would be wrong: music falls away steeply with frequency,
 *    so "flat" would mean boosting every treble band to the limit, always.
 *  - The per-track measurement is an exponential moving average over seconds,
 *    so it follows the record rather than the beat. Without that the
 *    correction pumps in time with the kick drum.
 *  - Corrections are bounded and re-centred, so it re-balances rather than
 *    turning everything up.
 *  - It only measures above a silence floor, so intros, gaps and pauses do
 *    not drag the average around.
 */

/** How often the correction is recomputed. Fast enough to settle within a
 *  few seconds of a track starting, slow enough to cost nothing. */
const ADAPTIVE_HZ = 4;

/** Seconds of audio the per-track average covers. The correction follows the
 *  record, not the bar. */
const ADAPTIVE_WINDOW_S = 6;

/** Minutes of listening the long-term reference covers. This is what
 *  "normal" means, so it has to move far more slowly than one record. */
const REFERENCE_WINDOW_MIN = 20;

/** Ceiling on any single band, in dB. Enough to pull an outlier back into
 *  line, too little to wreck a mix. */
const ADAPTIVE_MAX_DB = 6;

/** Where the ceiling starts tapering, in Hz. Between these the full range is
 *  available; outside them it shrinks toward zero at the edges of hearing. */
const ADAPTIVE_FULL_RANGE = [50, 14000];

/** Frames quieter than this are not measured — silence is not a balance. */
const ADAPTIVE_FLOOR = 0.02;

const REFERENCE_KEY = 'auralflow-adaptive-reference';

const adaptive = {
    on: false,
    timer: null,
    /** Balance of the record playing now, in dB per band. */
    average: null,
    /** Long-term balance of everything played — the listener's own norm. */
    reference: null,
    /** The correction currently applied, in dB per band. */
    applied: null,
    /** Band centre frequencies, taken from the engine's own EQ. */
    frequencies: null,
    /** Tilt in dB per decade: negative is warmer, positive is brighter. */
    tilt: 0,
    /** 0..1 — how much of the computed correction to actually apply. */
    strength: 0.7,
};

function adaptiveBands() {
    /* The manager exposes the band centres as a plain property; there is no
       getter for them the way there is for gains. */
    const freqs = audioContextManager?.frequencies;
    return Array.isArray(freqs) && freqs.length > 0 ? freqs : null;
}

function loadReference(bandCount) {
    try {
        const raw = JSON.parse(localStorage.getItem(REFERENCE_KEY) || 'null');
        if (Array.isArray(raw) && raw.length === bandCount && raw.every(Number.isFinite)) {
            return raw;
        }
    } catch {
        /* nothing stored, or storage unavailable */
    }
    return null;
}

let referenceSaveAt = 0;
function saveReference(reference) {
    /* The reference drifts over many minutes; writing it once a minute is
       plenty and keeps a synchronous write out of the audio path. */
    const now = Date.now();
    if (now - referenceSaveAt < 60000) return;
    referenceSaveAt = now;
    try {
        localStorage.setItem(REFERENCE_KEY, JSON.stringify(reference));
    } catch {
        /* storage unavailable — the reference stays in memory this session */
    }
}

/** Average FFT magnitude across one band, converted to dB. */
function bandLevelDb(bins, binHz, lower, upper) {
    const from = Math.max(0, Math.floor(lower / binHz));
    const to = Math.min(bins.length - 1, Math.ceil(upper / binHz));
    let sum = 0;
    let count = 0;
    for (let b = from; b <= to; b++) {
        sum += bins[b];
        count++;
    }
    if (count === 0) return null;
    const mean = sum / count / 255;
    /* Byte FFT data is already logarithmic; map it back to a dB-like scale
       with a floor so silent bands do not pull the average to -Infinity. */
    return 20 * Math.log10(Math.max(mean, 1e-3));
}

/**
 * How much correction a band is allowed, in dB.
 *
 * The extremes get less. Below around 50 Hz and above around 14 kHz, masters
 * differ for reasons that are not tonal balance — a high-pass on old material,
 * a lowpass from the source format, dither noise — and there is little there to
 * hear anyway. Correcting those as hard as the midrange just lifts rumble and
 * hiss, so the ceiling tapers to nothing at the edges of hearing.
 */
function bandCeiling(hz) {
    const [low, high] = ADAPTIVE_FULL_RANGE;
    if (hz >= low && hz <= high) return ADAPTIVE_MAX_DB;

    /* Taper across the octaves outside the full-range window. */
    const octaves = hz < low ? Math.log2(low / Math.max(hz, 1)) : Math.log2(hz / high);
    const scale = Math.max(0, 1 - octaves / 2);
    return ADAPTIVE_MAX_DB * scale;
}

function adaptiveStep() {
    const analyser = audioContextManager?.getAnalyser?.();
    const ctx = audioContextManager?.getAudioContext?.();
    const el = currentElement();
    if (!analyser || !ctx || !el || el.paused) return;

    const freqs = adaptive.frequencies || adaptiveBands();
    if (!freqs) return;
    adaptive.frequencies = freqs;

    /* Skip frames that are effectively silent, so gaps do not skew the
       measurement toward a balance nobody heard. */
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
        const v = (samples[i] - 128) / 128;
        sumSquares += v * v;
    }
    if (Math.sqrt(sumSquares / samples.length) < ADAPTIVE_FLOOR) return;

    const bins = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bins);
    const nyquist = ctx.sampleRate / 2;
    const binHz = nyquist / bins.length;

    /* Measure each EQ band over the span between its neighbours. */
    const measured = freqs.map((centre, i) => {
        const lower = i === 0 ? 0 : Math.sqrt(centre * freqs[i - 1]);
        const upper = i === freqs.length - 1 ? nyquist : Math.sqrt(centre * freqs[i + 1]);
        return bandLevelDb(bins, binHz, lower, upper);
    });

    /* Fold the frame into the per-track average. The weight comes from the
       window length, so changing either stays consistent. */
    const alpha = 1 / (ADAPTIVE_WINDOW_S * ADAPTIVE_HZ);
    if (!adaptive.average) {
        adaptive.average = measured.map((m) => (m === null ? -60 : m));
    } else {
        for (let i = 0; i < measured.length; i++) {
            if (measured[i] === null) continue;
            adaptive.average[i] += alpha * (measured[i] - adaptive.average[i]);
        }
    }

    /* The reference is the balance of everything this listener plays. A
       record that already sounds like the rest of their library is left
       alone; only the outliers get pulled back into line.
   
       Correcting toward a flat band average instead would be wrong: music
       has a steep natural spectral slope, so "flat" would mean boosting
       every treble band to the limit on every track. */
    if (!adaptive.reference) {
        adaptive.reference = loadReference(freqs.length) || [...adaptive.average];
    }
    const refAlpha = 1 / (REFERENCE_WINDOW_MIN * 60 * ADAPTIVE_HZ);
    for (let i = 0; i < adaptive.reference.length; i++) {
        adaptive.reference[i] += refAlpha * (adaptive.average[i] - adaptive.reference[i]);
    }
    saveReference(adaptive.reference);

    const centre = Math.log10(freqs[Math.floor(freqs.length / 2)] || 1000);

    /* Scale by strength first, so the control still does something on
       material that would otherwise saturate the limit. */
    let curve = adaptive.average.map((level, i) => {
        const decades = Math.log10(freqs[i] || 1) - centre;
        return (adaptive.reference[i] + adaptive.tilt * decades - level) * adaptive.strength;
    });

    /* Then alternate centring and clamping. Centring is what makes this a
       re-balance rather than a volume control; clamping is what keeps it
       from wrecking a mix. Two passes settles the two against each other. */
    const ceilings = freqs.map(bandCeiling);
    for (let pass = 0; pass < 2; pass++) {
        const bias = curve.reduce((a, b) => a + b, 0) / curve.length;
        curve = curve.map((c, i) => {
            const limit = ceilings[i];
            return Math.max(-limit, Math.min(limit, c - bias));
        });
    }

    adaptive.applied = curve;
    audioContextManager.applyTransientGains(curve, 0.25);
}

function startAdaptive() {
    if (adaptive.timer) return;
    adaptive.on = true;
    adaptive.average = null;
    adaptive.frequencies = adaptiveBands();
    adaptive.timer = setInterval(adaptiveStep, Math.round(1000 / ADAPTIVE_HZ));
}

function stopAdaptive() {
    if (adaptive.timer) {
        clearInterval(adaptive.timer);
        adaptive.timer = null;
    }
    adaptive.on = false;
    adaptive.average = null;
    adaptive.applied = null;
    /* Hand the graph back to whatever the user had set by hand. */
    const gains = audioContextManager?.getGains?.();
    if (Array.isArray(gains)) audioContextManager.applyTransientGains(gains, 0.1);
}

/** Forget the per-track measurement — called when the track changes, so a new
 *  record is judged on its own terms. The long-term reference is kept: that
 *  is the point of it. */
function resetAdaptive() {
    if (adaptive.on) adaptive.average = null;
}

/**
 * The engine's lyrics manager.
 *
 * The app initialises this itself during boot, and `initialize` throws if it
 * is called twice — so take the existing instance and only construct one if
 * the app has not got there yet.
 */
let lyricsManagerPromise = null;
function lyricsManager() {
    try {
        return Promise.resolve(LyricsManager.instance);
    } catch {
        /* Not initialised yet — the getter throws rather than returning null. */
    }
    if (!lyricsManagerPromise) {
        lyricsManagerPromise = LyricsManager.initialize(api).catch((e) => {
            lyricsManagerPromise = null;
            /* Lost a race with the app's own boot: use what it made. */
            try {
                return LyricsManager.instance;
            } catch {
                throw e;
            }
        });
    }
    return lyricsManagerPromise;
}

/** Find the full catalogue object for a track the shell only has serialized. */
async function resolveTrack(id) {
    const key = String(id);
    let full = trackCache.get(key) || libraryCache.get(key);
    if (!full) {
        full = await api.getTrack(key).catch(() => null);
        if (full) remember(libraryCache, full);
    }
    return full;
}

/** The engine's queue, as the shell needs to draw it. */
function readQueue() {
    const items = player?.getCurrentQueue?.() ?? [];
    return {
        tracks: items.map(serializeTrack).filter(Boolean),
        index: Number(player?.currentQueueIndex ?? -1),
    };
}

/** Everything the shell needs to render and drive the Audio Lab. */
function readEqState() {
    return {
        enabled: Boolean(audioContextManager?.isEQEnabled),
        gains: audioContextManager?.getGains?.() ?? [],
        frequencies: adaptiveBands() ?? [],
        preamp: Number(audioContextManager?.getPreamp?.() ?? 0),
        adaptive: {
            on: adaptive.on,
            tilt: adaptive.tilt,
            strength: adaptive.strength,
            /* What the stabiliser is applying right now, so the UI can draw
               the correction over the user's own curve. */
            curve: adaptive.applied,
        },
    };
}

/* ------------------------------------------------------------------ */
/* Live spectrum — real FFT from the shared analyser                  */
/* ------------------------------------------------------------------ */

function startSpectrum() {
    if (spectrumTimer) return;

    spectrumTimer = setInterval(() => {
        const analyser = audioContextManager?.getAnalyser?.();
        const ctx = audioContextManager?.getAudioContext?.();
        const el = currentElement();
        if (!analyser || !ctx || !el || el.paused) return;

        const bins = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bins);

        // Map FFT bins onto the ten display bands by averaging each band's range.
        const nyquist = ctx.sampleRate / 2;
        const binHz = nyquist / bins.length;
        const levels = BANDS.map((centre, i) => {
            const lower = i === 0 ? 0 : Math.sqrt(centre * BANDS[i - 1]);
            const upper = i === BANDS.length - 1 ? nyquist : Math.sqrt(centre * BANDS[i + 1]);
            const from = Math.max(0, Math.floor(lower / binHz));
            const to = Math.min(bins.length - 1, Math.ceil(upper / binHz));
            let sum = 0;
            let count = 0;
            for (let b = from; b <= to; b++) {
                sum += bins[b];
                count++;
            }
            return count > 0 ? sum / count / 255 : 0;
        });

        // Real RMS of the current window, so the shell can build a waveform
        // from what has actually been heard.
        const samples = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(samples);
        let sumSquares = 0;
        for (let i = 0; i < samples.length; i++) {
            const v = (samples[i] - 128) / 128;
            sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / samples.length);

        send('spectrum', {
            levels,
            rms,
            position: Number(el.currentTime) || 0,
            duration: Number(el.duration) || 0,
            sampleRate: ctx.sampleRate,
        });
    }, Math.round(1000 / SPECTRUM_FPS));
}

function stopSpectrum() {
    if (spectrumTimer) {
        clearInterval(spectrumTimer);
        spectrumTimer = null;
    }
}

/* ------------------------------------------------------------------ */
/* Commands from the shell                                            */
/* ------------------------------------------------------------------ */

async function handleCommand(type, data) {
    if (!player) return;

    switch (type) {
        case 'search': {
            const query = String(data.query ?? '').trim();
            if (!query) return;
            try {
                const res = await api.searchTracks(query, { limit: 40 });
                const items = res?.items ?? res?.tracks?.items ?? (Array.isArray(res) ? res : []);
                trackCache.clear();
                for (const item of items) remember(trackCache, item);
                send('searchresults', {
                    query,
                    results: items.map(serializeTrack).filter((t) => t && !t.isUnavailable),
                });
            } catch (e) {
                send('error', { scope: 'search', message: String(e?.message ?? e) });
                send('searchresults', { query, results: [] });
            }
            break;
        }

        case 'play': {
            const { trackId, tracks } = data;
            if (!Array.isArray(tracks) || tracks.length === 0) return;
            try {
                /* Prefer the cached originals; only fetch what is genuinely
                   missing (for example a track surfaced from the shell's own
                   history rather than the current search). */
                const queue = [];
                for (const t of tracks) {
                    const id = String(t.id);
                    const full = await resolveTrack(id);
                    if (full) queue.push(full);
                }
                if (queue.length === 0) {
                    send('error', { scope: 'play', message: 'no playable tracks resolved' });
                    return;
                }

                const index = Math.max(
                    0,
                    queue.findIndex((t) => String(t.id) === String(trackId))
                );
                await player.setQueue(queue, index);
                await player.playAtIndex(index);
            } catch (e) {
                send('error', { scope: 'play', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'toggle':
            await player.handlePlayPause();
            break;

        case 'next':
            await player.playNext();
            break;

        case 'prev':
            await player.playPrev();
            break;

        case 'seek': {
            const time = Number(data.time);
            if (Number.isFinite(time)) await player.seekTo(time, { resume: true });
            break;
        }

        case 'volume': {
            const level = Number(data.level);
            if (Number.isFinite(level)) player.setVolume(Math.max(0, Math.min(1, level)));
            break;
        }

        case 'getstate': {
            const el = currentElement();
            send('state', {
                currentTrack: serializeTrack(player.currentTrack),
                currentTime: Number(el?.currentTime) || 0,
                duration: Number(el?.duration) || 0,
                paused: el ? el.paused : true,
                streamInfo: serializeStreamInfo(),
            });
            break;
        }

        case 'repeat': {
            /* Hand repeat to the engine so its own queue-end handling wraps
               correctly, rather than emulating it from the shell. */
            const map = { off: REPEAT_MODE.OFF, all: REPEAT_MODE.ALL, one: REPEAT_MODE.ONE };
            player.repeatMode = map[String(data.mode)] ?? REPEAT_MODE.OFF;
            await player.saveQueueState?.();
            send('repeat', { mode: data.mode });
            break;
        }

        case 'shuffle': {
            /* The engine keeps a separate shuffled ordering; toggling here
               keeps its preloading and crossfade picks consistent. */
            const enabled = Boolean(data.enabled);
            if (enabled !== player.shuffleActive) {
                const queue = player.queue ?? [];
                const current = player.currentTrack;
                if (enabled) {
                    const rest = queue.filter((t) => (t?.track ?? t)?.id !== (current?.track ?? current)?.id);
                    for (let i = rest.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [rest[i], rest[j]] = [rest[j], rest[i]];
                    }
                    player.shuffledQueue = current ? [current, ...rest] : rest;
                    player.currentQueueIndex = 0;
                } else {
                    const idx = queue.findIndex(
                        (t) => (t?.track ?? t)?.id === (current?.track ?? current)?.id
                    );
                    player.currentQueueIndex = idx >= 0 ? idx : 0;
                }
                player.shuffleActive = enabled;
                await player.saveQueueState?.();
            }
            send('shuffle', { enabled });
            break;
        }

        case 'quality': {
            /* Maps AuralFlow's Streaming Quality tiers onto the engine's own
               quality tokens, so the setting actually changes what is fetched. */
            const map = {
                'hi-res': 'HI_RES_LOSSLESS',
                lossless: 'LOSSLESS',
                high: 'HIGH',
            };
            const token = map[String(data.tier)] ?? 'HI_RES_LOSSLESS';
            player.setQuality(token);
            send('quality', { tier: data.tier, token });
            break;
        }

        case 'spatial': {
            /* Binaural / head-tracked rendering via the engine's DSP chain. */
            try {
                await audioContextManager.toggleBinaural(Boolean(data.enabled));
                send('spatial', { enabled: Boolean(data.enabled) });
            } catch (e) {
                send('error', { scope: 'spatial', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'instances': {
            /* The catalogue and streaming backends the engine talks to.
   
               This build ships with no instance list and no discovery URL, so
               it falls back to a single hard-coded API entry and no streaming
               entry at all — which is why nothing plays until an instance is
               supplied here. */
            try {
                if (Array.isArray(data.add)) {
                    for (const entry of data.add) {
                        const url = String(entry?.url ?? '').trim();
                        const type = entry?.type === 'streaming' ? 'streaming' : 'api';
                        if (url) apiSettings.addUserInstance(type, url);
                    }
                }
                if (Array.isArray(data.remove)) {
                    for (const entry of data.remove) {
                        const url = String(entry?.url ?? '').trim();
                        const type = entry?.type === 'streaming' ? 'streaming' : 'api';
                        if (url) apiSettings.removeUserInstance(type, url);
                    }
                }
                if (data.refresh) await apiSettings.refreshInstances();

                const listed = await apiSettings.loadInstancesFromGitHub().catch(() => null);
                const user = apiSettings._loadUserInstances();
                const shape = (items) =>
                    (items || []).map((i) => (typeof i === 'string' ? { url: i } : { url: i.url, version: i.version }));

                send('instances', {
                    discovered: {
                        api: shape(listed?.api),
                        streaming: shape(listed?.streaming),
                    },
                    user: { api: shape(user?.api), streaming: shape(user?.streaming) },
                    playbackConfigured: await playbackAvailable(),
                });
            } catch (e) {
                send('error', { scope: 'instances', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'album': {
            /* The real record from the catalogue, not whatever happened to be
               in the last search. */
            try {
                const result = await api.getAlbum(String(data.id));
                const album = result?.album ?? result;
                const tracks = (result?.tracks ?? album?.items ?? [])
                    .map(serializeTrack)
                    .filter(Boolean);
                for (const t of result?.tracks ?? []) remember(libraryCache, t);
                send('album', {
                    id: String(data.id),
                    title: String(album?.title ?? ''),
                    artist: String(album?.artist?.name ?? album?.artists?.[0]?.name ?? ''),
                    cover: coverUrl(album, 640),
                    year: Number(String(album?.releaseDate ?? '').slice(0, 4)) || null,
                    tracks,
                });
            } catch (e) {
                send('album', { id: String(data.id), tracks: [], error: String(e?.message ?? e) });
            }
            break;
        }

        case 'artist': {
            try {
                const artist = await api.getArtist(String(data.id));
                const tracks = (artist?.tracks ?? []).map(serializeTrack).filter(Boolean);
                for (const t of artist?.tracks ?? []) remember(libraryCache, t);
                const albums = [...(artist?.albums ?? []), ...(artist?.eps ?? [])].map((a) => ({
                    id: String(a?.id ?? a?.appleMusicId ?? ''),
                    title: String(a?.title ?? ''),
                    cover: coverUrl(a, 320),
                    year: Number(String(a?.releaseDate ?? '').slice(0, 4)) || null,
                }));
                send('artist', {
                    id: String(data.id),
                    name: String(artist?.name ?? ''),
                    cover: coverUrl(artist, 640),
                    tracks,
                    albums,
                });
            } catch (e) {
                send('artist', { id: String(data.id), tracks: [], albums: [], error: String(e?.message ?? e) });
            }
            break;
        }

        case 'download': {
            /* Save a track, or the whole queue, to disk.
   
               The engine's own downloader does this: it fetches the stream,
               transcodes where the chosen format needs it, and writes the
               tags and cover art. The shell only says what and at which
               quality — the file lands in the music folder, which the native
               shell picks for the webview. */
            try {
                const quality = String(data.quality || downloadQualitySettings.getQuality());
                const manager = await lyricsManager().catch(() => null);

                if (data.scope === 'queue') {
                    const items = player?.getCurrentQueue?.() ?? [];
                    if (items.length === 0) {
                        send('download', { state: 'error', message: 'The queue is empty.' });
                        break;
                    }
                    send('download', { state: 'started', count: items.length });
                    await downloadTracks(items, api, quality, manager);
                    send('download', { state: 'done', count: items.length });
                    break;
                }

                const id = String(data.trackId ?? player?.currentTrack?.id ?? '');
                const track = id ? await resolveTrack(id) : player?.currentTrack;
                if (!track) {
                    send('download', { state: 'error', message: 'That track could not be resolved.' });
                    break;
                }
                send('download', { state: 'started', count: 1, title: track.title });
                await downloadTrackWithMetadata(track, quality, api, manager);
                send('download', { state: 'done', count: 1, title: track.title });
            } catch (e) {
                send('download', { state: 'error', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'downloadquality': {
            try {
                if (data.quality) downloadQualitySettings.setQuality(String(data.quality));
                send('downloadquality', { quality: downloadQualitySettings.getQuality() });
            } catch (e) {
                send('error', { scope: 'downloadquality', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'lyrics': {
            /* Lyrics for the track playing now. Synced lines carry a
               timestamp so the shell can follow along; plain lyrics come
               back as a single block with no timings. */
            try {
                const current = player?.currentTrack;
                if (!current) {
                    send('lyrics', { trackId: null, lines: [], plain: '', synced: false });
                    break;
                }
                const manager = await lyricsManager();
                const result = await manager.fetchLyrics(String(current.id), current);
                const subtitles = result?.subtitles ?? result?.syncedLyrics ?? '';
                const lines = subtitles ? manager.parseSyncedLyrics(subtitles) : [];
                send('lyrics', {
                    trackId: String(current.id),
                    lines,
                    plain: String(result?.lyrics ?? result?.plainLyrics ?? ''),
                    synced: lines.length > 0,
                });
            } catch (e) {
                send('lyrics', { trackId: null, lines: [], plain: '', synced: false });
                send('error', { scope: 'lyrics', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'queue': {
            /* Read the engine's real queue. This is the same list playback,
               shuffle and repeat all work from, so what the shell shows and
               what plays next cannot drift apart. */
            try {
                send('queue', readQueue());
            } catch (e) {
                send('error', { scope: 'queue', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'queueadd': {
            /* `next: true` drops the tracks in after the current one;
               otherwise they go on the end. */
            try {
                const incoming = Array.isArray(data.tracks) ? data.tracks : [];
                const resolved = [];
                for (const t of incoming) {
                    const full = await resolveTrack(t.id);
                    if (full) resolved.push(full);
                }
                if (resolved.length === 0) {
                    send('error', { scope: 'queueadd', message: 'no playable tracks resolved' });
                    break;
                }
                if (data.next) await player.addNextToQueue(resolved);
                else await player.addToQueue(resolved);
                send('queue', readQueue());
            } catch (e) {
                send('error', { scope: 'queueadd', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'queueremove': {
            try {
                await player.removeFromQueue(Number(data.index));
                send('queue', readQueue());
            } catch (e) {
                send('error', { scope: 'queueremove', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'queuemove': {
            try {
                await player.moveInQueue(Number(data.from), Number(data.to));
                send('queue', readQueue());
            } catch (e) {
                send('error', { scope: 'queuemove', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'queueclear': {
            try {
                await player.clearQueue();
                send('queue', readQueue());
            } catch (e) {
                send('error', { scope: 'queueclear', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'queueplay': {
            /* Jump straight to a position in the queue. */
            try {
                await player.playAtIndex(Number(data.index));
                send('queue', readQueue());
            } catch (e) {
                send('error', { scope: 'queueplay', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'atmos': {
            /* Whether the engine should pick the Atmos master when a track
               offers one. The shell had this toggle from the start but never
               sent it anywhere, so it did nothing. */
            try {
                preferDolbyAtmosSettings.setEnabled(Boolean(data.enabled));
                send('atmos', { enabled: preferDolbyAtmosSettings.isEnabled() });
            } catch (e) {
                send('error', { scope: 'atmos', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'eqstate': {
            /* Everything the Audio Lab needs to draw itself. */
            try {
                send('eqstate', readEqState());
            } catch (e) {
                send('error', { scope: 'eqstate', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'eq': {
            /* Manual EQ: enable/disable, set the curve, set the preamp.
               Turning a band by hand takes the adaptive layer off, since the
               two would otherwise fight over the same filters. */
            try {
                if (data.enabled !== undefined) {
                    audioContextManager.toggleEQ(Boolean(data.enabled));
                }
                if (Array.isArray(data.gains)) {
                    if (adaptive.on) stopAdaptive();
                    audioContextManager.setAllGains(data.gains.map(Number));
                }
                if (data.preamp !== undefined) {
                    audioContextManager.setPreamp(Number(data.preamp) || 0);
                }
                send('eqstate', readEqState());
            } catch (e) {
                send('error', { scope: 'eq', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'offline': {
            /* Everything downloaded, served by the native shell from the music
               folder. The webview cannot read the disk itself, so the shell
               lists and serves them over the same local origin. */
            try {
                const res = await fetch('/offline-index.json');
                if (!res.ok) throw new Error(`listing failed (${res.status})`);
                const body = await res.json();
                send('offline', {
                    tracks: (body?.tracks ?? []).map((t) => ({
                        id: `offline:${t.path}`,
                        title: String(t.name ?? t.path ?? ''),
                        artist: 'Downloaded',
                        album: '',
                        duration: 0,
                        cover: '',
                        coverLarge: '',
                        audioQuality: '',
                        audioModes: [],
                        genre: '',
                        trackNumber: 0,
                        isUnavailable: false,
                        albumId: null,
                        artistId: null,
                        size: Number(t.size) || 0,
                        path: String(t.path ?? ''),
                    })),
                });
            } catch (e) {
                send('offline', { tracks: [], error: String(e?.message ?? e) });
            }
            break;
        }

        case 'playoffline': {
            /* Play a downloaded file.
   
               The player already has a path for tracks that carry their own
               URL, so a local file goes through exactly the same pipeline as
               anything streamed — equaliser, analyser, transport and all —
               rather than needing a second player beside it. */
            try {
                const items = Array.isArray(data.tracks) ? data.tracks : [];
                if (items.length === 0) break;

                const queue = items.map((t) => {
                    const path = String(t.path ?? '');
                    return {
                        id: String(t.id ?? `offline:${path}`),
                        title: String(t.title ?? path),
                        artist: { name: 'Downloaded' },
                        artists: [{ name: 'Downloaded' }],
                        album: { title: '' },
                        duration: Number(t.duration) || 0,
                        audioQuality: 'LOSSLESS',
                        audioModes: [],
                        /* The engine plays this directly. `isLocal` must stay
                           false: that flag means a File handle it would try to
                           read itself, which the webview cannot do. */
                        audioUrl: `/offline/${path.split('/').map(encodeURIComponent).join('/')}`,
                        isLocal: false,
                        isUnavailable: false,
                    };
                });

                const index = Math.max(0, queue.findIndex((t) => t.id === String(data.trackId)));
                for (const t of queue) remember(libraryCache, t);
                await player.setQueue(queue, index);
                await player.playAtIndex(index);
            } catch (e) {
                send('error', { scope: 'playoffline', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'eqpresets': {
            /* The engine's own preset curves, interpolated to however many
               bands the EQ is running. */
            try {
                const bandCount = adaptiveBands()?.length ?? 16;
                const presets = getPresetsForBandCount(bandCount);
                send('eqpresets', {
                    presets: Object.entries(presets).map(([id, p]) => ({
                        id,
                        name: String(p?.name ?? id),
                        gains: Array.isArray(p?.gains) ? p.gains : [],
                    })),
                });
            } catch (e) {
                send('error', { scope: 'eqpresets', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'autoeqlist': {
            /* Headphone corrections. The full AutoEQ index is thousands of
               entries fetched from the network, so offer the popular ones
               immediately and search the index only when asked. */
            try {
                const query = String(data.query ?? '').trim();
                let entries = POPULAR_HEADPHONES;
                if (query) {
                    const index = await fetchAutoEqIndex().catch(() => null);
                    entries = searchHeadphones(query, index || POPULAR_HEADPHONES, 'all', 40);
                }
                send('autoeqlist', {
                    query,
                    headphones: (entries || []).slice(0, 40).map((e) => ({
                        name: String(e.name ?? ''),
                        type: String(e.type ?? ''),
                        path: String(e.path ?? ''),
                        fileName: String(e.fileName ?? ''),
                    })),
                    targets: TARGETS.map((t) => ({ id: t.id, label: t.label })),
                });
            } catch (e) {
                send('error', { scope: 'autoeqlist', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'autoeqapply': {
            /* Fetch a headphone's measured response, work out the filters that
               bring it to the chosen target, and apply them. */
            try {
                const entry = data.headphone;
                if (!entry?.path || !entry?.fileName) {
                    send('autoeq', { applied: false, message: 'No headphone chosen.' });
                    break;
                }
                const target = TARGETS.find((t) => t.id === String(data.target)) ?? TARGETS[0];
                const measurement = await fetchHeadphoneData(entry);
                if (!Array.isArray(measurement) || measurement.length === 0) {
                    send('autoeq', { applied: false, message: 'That measurement could not be fetched.' });
                    break;
                }

                const bandCount = adaptiveBands()?.length ?? 10;
                const bands = runAutoEqAlgorithm(measurement, target.data, bandCount);
                if (!bands || bands.length === 0) {
                    send('autoeq', { applied: false, message: 'No correction needed for this pairing.' });
                    break;
                }

                /* A correction is a fixed response for the hardware, so the
                   adaptive layer has to stand down — both drive the same
                   filters, and the stabiliser would undo it. */
                if (adaptive.on) stopAdaptive();
                audioContextManager.toggleEQ(true);
                audioContextManager.applyAutoEQBands(bands);

                send('autoeq', {
                    applied: true,
                    headphone: String(entry.name ?? ''),
                    target: target.label,
                    bands: bands.length,
                });
                send('eqstate', readEqState());
            } catch (e) {
                send('autoeq', { applied: false, message: String(e?.message ?? e) });
            }
            break;
        }

        case 'adaptiveeq': {
            /* The stabiliser. Needs the EQ chain live to have anything to
               act on, so switch that on with it. */
            try {
                const enabled = Boolean(data.enabled);
                if (data.tilt !== undefined) {
                    adaptive.tilt = Math.max(-6, Math.min(6, Number(data.tilt) || 0));
                }
                if (data.strength !== undefined) {
                    adaptive.strength = Math.max(0, Math.min(1, Number(data.strength) || 0));
                }
                if (enabled) {
                    audioContextManager.toggleEQ(true);
                    startAdaptive();
                } else if (adaptive.on) {
                    stopAdaptive();
                }
                send('eqstate', readEqState());
            } catch (e) {
                send('error', { scope: 'adaptiveeq', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'playbackconfig': {
            /* Point the engine at a playback endpoint the user is entitled to
               use. Sending empty values clears it and leaves playback off. */
            const baseUrl = String(data.baseUrl ?? '').trim();
            const token = String(data.token ?? '').trim();
            try {
                unifiedPlaybackSettings.setApiBaseUrl(baseUrl);
                unifiedPlaybackSettings.setApiToken(token);
                unifiedPlaybackSettings.setEnabled(Boolean(baseUrl && token));
                send('playbackconfig', { configured: await playbackAvailable() });
            } catch (e) {
                send('error', { scope: 'playbackconfig', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'import': {
            /* Bring a library across from another service.
   
               Every mainstream player exports one of these formats, and each
               parser resolves its rows against this catalogue — by ISRC where
               the export carries one, which is an exact match rather than a
               guess, and by title/artist/album similarity otherwise. */
            const text = String(data.text ?? '');
            const format = String(data.format ?? 'csv').toLowerCase();
            if (!text.trim()) {
                send('importdone', { error: 'The file is empty.' });
                break;
            }

            const parsers = {
                csv: parseDynamicCSV,
                jspf: parseJSPF,
                xspf: parseXSPF,
                xml: parseXML,
                m3u: parseM3U,
            };
            const parse = parsers[format];
            if (!parse) {
                send('importdone', { error: `Unsupported format: ${format}` });
                break;
            }

            /* Apple Music and other XML exports carry a DOCTYPE the engine's
               parser refuses outright; clean it rather than reject the file. */
            let source = text;
            let parser = parse;
            if (format === 'xml' || format === 'xspf') {
                source = sanitizeXml(text);
                if (source === null) {
                    send('importdone', {
                        error: 'This file declares XML entities, which are not safe to expand. Export it again without them.',
                    });
                    break;
                }

                /* An Apple library is a property list, not playlist XML, so
                   route it through the CSV importer instead — that is the path
                   with playlist grouping and ISRC matching. */
                const asCsv = appleLibraryToCsv(source);
                if (asCsv) {
                    source = asCsv;
                    parser = parsers.csv;
                }
            }

            const onProgress = (p) => {
                send('importprogress', {
                    current: Number(p?.current) || 0,
                    total: Number(p?.total) || 0,
                    item: String(p?.currentItem ?? p?.item ?? ''),
                });
            };

            try {
                /* The parsers hit the catalogue once per row and pace
                   themselves to stay under its rate limit. */
                const result = await parser(source, api, onProgress);
                /* These are full catalogue objects; keep them so playing the
                   imported list later needs no second lookup. */
                for (const item of result.tracks || []) remember(libraryCache, item);
                const tracks = (result.tracks || []).map(serializeTrack).filter(Boolean);
                const playlists = Object.entries(result.playlists || {}).map(([name, items]) => ({
                    name,
                    tracks: (items || []).map(serializeTrack).filter(Boolean),
                }));
                const missing = (result.missingItems || result.missingTracks || []).map((m) => ({
                    title: String(m?.title ?? ''),
                    artist: String(m?.artist ?? ''),
                    type: String(m?.type ?? 'track'),
                }));

                /* Nothing found and nothing missing means no rows were read at
                   all — a shape the parser does not recognise, or a malformed
                   file. Reporting "0 of 0 matched" would suggest the import
                   worked and the library was empty. */
                if (tracks.length === 0 && missing.length === 0) {
                    send('importdone', {
                        error:
                            'No tracks could be read from this file. It may be a format ' +
                            'this cannot parse, or the export may be incomplete.',
                    });
                    break;
                }

                send('importdone', { tracks, playlists, missing });
            } catch (e) {
                send('importdone', { error: String(e?.message ?? e) });
            }
            break;
        }

        case 'ping':
            send('pong');
            break;
    }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                             */
/* ------------------------------------------------------------------ */

function attachElementListeners() {
    for (const el of player.audioElements ?? []) {
        el.addEventListener('play', () => {
            emitState('playing');
            startSpectrum();
        });
        el.addEventListener('pause', () => {
            emitState('paused');
            stopSpectrum();
        });
        el.addEventListener('waiting', () => emitState('loading'));
        el.addEventListener('playing', () => emitState('playing'));
        el.addEventListener('ended', () => {
            stopSpectrum();
            emitState('ended');
        });
        el.addEventListener('loadedmetadata', () => emitTrackLoaded());
        el.addEventListener('error', () =>
            send('error', { scope: 'playback', message: 'audio element error' })
        );
    }

    setInterval(emitTimeUpdate, TIMEUPDATE_MS);

    /* The player swaps tracks without always firing loadedmetadata on the same
       element (crossfade uses two), so watch the current track id as well. */
    let lastTrackId = null;
    setInterval(() => {
        const id = player?.currentTrack?.id ?? null;
        if (id !== lastTrackId) {
            lastTrackId = id;
            if (id != null) emitTrackLoaded();
        }
    }, 400);
}

/**
 * Both singletons expose `instance` getters that *throw* until the app has
 * initialized them, so probing has to swallow that rather than treat it as a
 * failure. Monochrome boots asynchronously (auth, catalogue, DSP), so this can
 * legitimately take several seconds.
 */
function readySingletons() {
    try {
        const p = Player.instance;
        const a = MusicAPI.instance;
        return p && a ? { player: p, api: a } : null;
    } catch {
        return null; // not initialized yet
    }
}

async function waitForPlayer(timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ready = readySingletons();
        if (ready) return ready;
        await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('Monochrome Player did not initialize in time');
}

async function boot() {
    try {
        const ready = await waitForPlayer();
        player = ready.player;
        api = ready.api;

        window.addEventListener('message', (e) => {
            const type = e.data?.type;
            if (typeof type !== 'string' || !type.startsWith('af:')) return;
            void handleCommand(type.slice(3), e.data);
        });

        attachElementListeners();
        send('ready', {
            version: 2,
            playbackConfigured: await playbackAvailable(),
            preferAtmos: (() => {
                try {
                    return preferDolbyAtmosSettings.isEnabled();
                } catch {
                    return false;
                }
            })(),
        });
    } catch (e) {
        send('error', { scope: 'boot', message: String(e?.message ?? e) });
    }
}

/* Only run inside the AuralFlow shell, never when Monochrome is opened directly. */
if (window.parent && window.parent !== window) {
    void boot();
}
