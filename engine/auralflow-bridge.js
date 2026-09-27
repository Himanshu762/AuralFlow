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
import { runAutoEqAlgorithm, calculateBiquadResponse } from './autoeq-engine.js';
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

/**
 * Re-delimit an export so the engine's CSV parser can read it.
 *
 * That parser splits on commas and nothing else. Tab-separated exports - which
 * this app offers to read, since it accepts .tsv and .txt - and the semicolon
 * CSVs Excel writes in most of Europe therefore collapse into a single column.
 * Every row then yields an empty title and artist, every row is reported as
 * not found, and nothing anywhere says why: the import looks like a catalogue
 * with none of your music in it.
 *
 * So sniff the delimiter off the header and rewrite the file with commas.
 */
function normalizeDelimiter(text) {
    const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0);
    if (!firstLine) return text;

    /* Count each candidate outside quotes; the real delimiter is the one that
       actually separates the header's fields. */
    const score = (delimiter) => {
        let count = 0;
        let inQuote = false;
        for (const char of firstLine) {
            if (char === '"') inQuote = !inQuote;
            else if (char === delimiter && !inQuote) count++;
        }
        return count;
    };

    /* Comma first, so a file that is already CSV is left exactly as it is. */
    let best = ',';
    for (const candidate of ['\t', ';', '|']) {
        if (score(candidate) > score(best)) best = candidate;
    }
    if (best === ',' || score(best) === 0) return text;

    const split = (line) => {
        const values = [];
        let current = '';
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
                else inQuote = !inQuote;
            } else if (char === best && !inQuote) { values.push(current); current = ''; }
            else current += char;
        }
        values.push(current);
        return values;
    };

    return text
        .split(/\r?\n/)
        .map((line) => (line.trim() ? split(line).map((v) => csvCell(v.trim())).join(',') : ''))
        .join('\n');
}

/**
 * Run a CSV import in batches, so progress can be reported honestly.
 *
 * The engine's parser resolves the whole file in a single call and returns
 * only at the very end. For a three-thousand-track library that is twenty
 * minutes during which nothing can be known about how it is going - the shell
 * can only show a match count of zero, which reads as a broken import rather
 * than a slow one. The parser holds no state between calls, so feeding it the
 * file a batch at a time yields the same result with a running count.
 */
async function parseCsvInBatches(csvText, catalogue, report, parse, size = 25) {
    const lines = csvText.split('\n');
    const header = lines[0];
    const rows = lines.slice(1).filter((line) => line.trim().length > 0);

    const tracks = [];
    const albums = [];
    const artists = [];
    const missingItems = [];
    const playlists = {};
    let format = 'library';

    for (let start = 0; start < rows.length; start += size) {
        const batch = rows.slice(start, start + size);
        const result = await parse([header, ...batch].join('\n'), catalogue, (p) =>
            report({
                current: start + (Number(p?.current) || 0),
                total: rows.length,
                currentItem: p?.currentItem,
                matched: tracks.length,
            })
        );

        format = result?.format ?? format;
        for (const t of result?.tracks || []) tracks.push(t);
        for (const a of result?.albums || []) albums.push(a);
        for (const a of result?.artists || []) artists.push(a);
        for (const m of result?.missingItems || []) missingItems.push(m);
        for (const [name, items] of Object.entries(result?.playlists || {})) {
            if (!playlists[name]) playlists[name] = [];
            for (const item of items || []) playlists[name].push(item);
        }

        report({
            current: Math.min(start + batch.length, rows.length),
            total: rows.length,
            currentItem: '',
            matched: tracks.length,
        });
    }

    return { format, tracks, albums, artists, missingItems, playlists };
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
    if (!measure || measure.trackId !== track.id) {
        if (measure) emitFeatures(true);
        resetMeasurement(track.id);
    }
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
    signature.track = curve;
    composeSignature(0.25);
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
    /* Drop the track layer; the other layers stay exactly as they were. */
    signature.track = null;
    composeSignature(0.1);
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
        signature: readSignature(),
    };
}

/* ------------------------------------------------------------------ */
/* Live analysis — spectrum for the shell, features for the library    */
/* ------------------------------------------------------------------ */

/*
 * One timer reads the engine's shared AnalyserNode while audio plays and
 * feeds two consumers:
 *
 *  - the shell's spectrum widget and measured waveform (`af:spectrum`);
 *  - the library's mood reading for the track (`af:features`).
 *
 * The features are the DJ's eyes. Nothing here is fetched from a catalogue
 * or guessed from a genre tag: every number is measured from the audio that
 * is actually coming out of the graph, accumulated for as long as the track
 * plays, and reported with how many seconds it rests on.
 *
 * What is measured, per frame, from the byte FFT and the time-domain window:
 *
 *   loudness       RMS of the window, in dBFS
 *   crest          peak-to-RMS ratio, in dB (compression tells on itself here)
 *   dynamic range  spread of frame loudness over the track (p95 − p10)
 *   centroid       spectral centre of mass, in Hz — brightness
 *   rolloff        frequency below which 85 % of the energy sits
 *   flatness       geometric / arithmetic mean of the spectrum — noisiness
 *   flux           how much the spectrum changed since the last frame
 *   band ratios    energy fraction below 150 Hz, in 300–3400 Hz, above 4 kHz
 *   chroma         energy per pitch class, for a key and major/minor reading
 *   onsets         the flux series, autocorrelated for tempo and beat strength
 *
 * The backend turns these into the five mood dimensions; see
 * backend/app/services/feature_service.py for the mapping and its caveats.
 */

const ANALYSIS_HZ = 30;
const SPECTRUM_EVERY = 2; // ticks — 15 fps to the shell is plenty
const FEATURES_EVERY_MS = 3000;
const ONSET_SECONDS = 12;
const SILENCE_RMS = 0.004;

/* Krumhansl–Kessler key profiles, for the major/minor reading. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

let analysisTimer = null;
let analysisTick = 0;
let lastFeaturesAt = 0;

/** Everything accumulated for the track currently being measured. */
let measure = null;

function newMeasurement(trackId) {
    return {
        trackId,
        frames: 0,
        loud: 0,           // Σ loudness dB
        peak: 0,           // max |sample|
        rmsLinear: 0,      // Σ rms
        centroid: 0,
        rolloff: 0,
        flatness: 0,
        flux: 0,
        lf: 0,
        vocal: 0,
        vocalSq: 0,
        hf: 0,
        chroma: new Float64Array(12),
        rmsDb: [],         // per-frame loudness for the dynamic-range percentiles
        onset: new Float32Array(ONSET_SECONDS * ANALYSIS_HZ),
        onsetPos: 0,
        onsetFilled: 0,
        prevMag: null,
        tempo: null,
        beatStrength: 0,
    };
}

function resetMeasurement(trackId) {
    measure = newMeasurement(trackId);
    lastFeaturesAt = Date.now();
}

/** Byte FFT value → linear magnitude, using the analyser's own dB range. */
function magnitudeTable(analyser) {
    const min = analyser.minDecibels;
    const range = analyser.maxDecibels - min;
    const table = new Float32Array(256);
    for (let v = 0; v < 256; v++) {
        table[v] = v === 0 ? 0 : Math.pow(10, (min + (v / 255) * range) / 20);
    }
    return table;
}
let magTable = null;
let magTableFor = null;

function analyseFrame(analyser, ctx, el) {
    const bins = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bins);
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);

    const nyquist = ctx.sampleRate / 2;
    const binHz = nyquist / bins.length;

    /* ---- Spectrum for the shell, on the ten display bands ---- */
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

    /* ---- Time domain: RMS and peak ---- */
    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
        const v = (samples[i] - 128) / 128;
        sumSquares += v * v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sumSquares / samples.length);

    analysisTick++;
    if (analysisTick % SPECTRUM_EVERY === 0) {
        send('spectrum', {
            levels,
            rms,
            position: Number(el.currentTime) || 0,
            duration: Number(el.duration) || 0,
            sampleRate: ctx.sampleRate,
        });
    }

    /* ---- Features: only frames with signal in them ---- */
    if (!measure || rms < SILENCE_RMS) return;

    if (magTableFor !== analyser) {
        magTable = magnitudeTable(analyser);
        magTableFor = analyser;
    }

    const n = bins.length;
    const mag = new Float32Array(n);
    const power = new Float32Array(n);
    let total = 0;
    let weighted = 0;
    let logSum = 0;
    let logCount = 0;
    let lf = 0;
    let vocal = 0;
    let hf = 0;
    let fluxNum = 0;
    let fluxDen = 0;
    const chroma = measure.chroma;

    for (let k = 1; k < n; k++) {
        const m = magTable[bins[k]];
        const p = m * m;
        const f = k * binHz;
        mag[k] = m;
        power[k] = p;
        total += p;
        weighted += f * p;
        if (f >= 50 && f <= 16000) {
            logSum += Math.log(p + 1e-12);
            logCount++;
        }
        if (f < 150) lf += p;
        else if (f >= 300 && f <= 3400) vocal += p;
        if (f > 4000) hf += p;
        if (measure.prevMag) {
            const d = m - measure.prevMag[k];
            if (d > 0) fluxNum += d;
            fluxDen += m;
        }
    }
    if (total <= 0) return;

    /* Chroma from spectral peaks only. Summing every bin lets broadband
       energy — drums, noise, a click — swamp the few bins that carry pitch,
       and the key reading turns to mush. A bin has to stand above its
       neighbours to count as a note. */
    const kLow = Math.max(4, Math.floor(60 / binHz));
    const kHigh = Math.min(n - 4, Math.ceil(5000 / binHz));
    for (let k = kLow; k <= kHigh; k++) {
        const m = mag[k];
        if (m <= mag[k - 1] || m < mag[k + 1]) continue;
        const floor = (mag[k - 3] + mag[k + 3]) / 2;
        if (m < floor * 2) continue;
        const f = k * binHz;
        /* Pitch class with C at index 0, to line up with the profiles
           (A440 sits nine semitones above C). */
        const pc = (((Math.round(12 * Math.log2(f / 440)) + 9) % 12) + 12) % 12;
        chroma[pc] += power[k];
    }

    /* Rolloff: the bin below which 85 % of the energy sits. */
    let acc = 0;
    let rolloffHz = nyquist;
    for (let k = 1; k < n; k++) {
        acc += power[k];
        if (acc >= 0.85 * total) {
            rolloffHz = k * binHz;
            break;
        }
    }

    const flux = measure.prevMag && fluxDen > 0 ? fluxNum / fluxDen : 0;
    const flatness = logCount > 0 ? Math.exp(logSum / logCount) / (total / (n - 1) + 1e-12) : 0;
    const vocalRatio = vocal / total;
    const loudDb = 20 * Math.log10(Math.max(rms, 1e-5));

    measure.frames++;
    measure.loud += loudDb;
    measure.rmsLinear += rms;
    if (peak > measure.peak) measure.peak = peak;
    measure.centroid += weighted / total;
    measure.rolloff += rolloffHz;
    measure.flatness += Math.min(1, flatness);
    measure.flux += flux;
    measure.lf += lf / total;
    measure.vocal += vocalRatio;
    measure.vocalSq += vocalRatio * vocalRatio;
    measure.hf += hf / total;
    if (measure.rmsDb.length < 12000) measure.rmsDb.push(loudDb);
    measure.prevMag = mag;

    /* Onset envelope for the tempo estimate. */
    measure.onset[measure.onsetPos] = flux;
    measure.onsetPos = (measure.onsetPos + 1) % measure.onset.length;
    if (measure.onsetFilled < measure.onset.length) measure.onsetFilled++;
}

/**
 * Tempo from the onset envelope: autocorrelate over the lags that map to
 * 60–200 BPM and take the strongest, refined by parabolic interpolation.
 * Beat strength is how far that peak stands above the rest.
 */
function estimateTempo() {
    if (!measure || measure.onsetFilled < ANALYSIS_HZ * 4) return;
    const len = measure.onsetFilled;
    const series = new Float32Array(len);
    let mean = 0;
    for (let i = 0; i < len; i++) {
        const idx = (measure.onsetPos - len + i + measure.onset.length) % measure.onset.length;
        series[i] = measure.onset[idx];
        mean += series[i];
    }
    mean /= len;
    let energy = 0;
    for (let i = 0; i < len; i++) {
        series[i] -= mean;
        energy += series[i] * series[i];
    }
    if (energy <= 1e-9) return;

    const minLag = Math.max(2, Math.floor((60 / 200) * ANALYSIS_HZ));
    const maxLag = Math.min(len - 2, Math.ceil((60 / 60) * ANALYSIS_HZ));
    const corr = new Float32Array(maxLag + 2);
    let sumCorr = 0;
    let count = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let s = 0;
        for (let i = lag; i < len; i++) s += series[i] * series[i - lag];
        corr[lag] = s / energy;
        sumCorr += corr[lag];
        count++;
    }
    let best = minLag;
    for (let lag = minLag + 1; lag <= maxLag; lag++) {
        if (corr[lag] > corr[best]) best = lag;
    }
    /* Autocorrelation peaks at every multiple of the beat, so the strongest
       lag can be the half- or double-tempo. Among the peaks that come close
       to the strongest, take the one nearest a typical tempo (~115 BPM). */
    const peakCorr = corr[best];
    const candidates = [best, best * 2, Math.round(best / 2)].filter(
        (lag) => lag >= minLag && lag <= maxLag && corr[lag] >= peakCorr * 0.85
    );
    if (candidates.length > 1) {
        const bpmOf = (lag) => (60 * ANALYSIS_HZ) / lag;
        best = candidates.reduce((a, b) =>
            Math.abs(Math.log(bpmOf(b) / 115)) < Math.abs(Math.log(bpmOf(a) / 115)) ? b : a
        );
    }

    let refined = best;
    if (best > minLag && best < maxLag) {
        const a = corr[best - 1];
        const b = corr[best];
        const c = corr[best + 1];
        const denom = a - 2 * b + c;
        if (Math.abs(denom) > 1e-9) refined = best + 0.5 * ((a - c) / denom);
    }
    const bpm = (60 * ANALYSIS_HZ) / refined;
    const avg = count > 0 ? sumCorr / count : 0;
    const strength = Math.max(0, Math.min(1, (corr[best] - avg) / Math.max(1e-6, 1 - avg)));

    measure.tempo = Math.round(bpm * 10) / 10;
    measure.beatStrength = Math.round(strength * 1000) / 1000;
}

function modeAndKey() {
    const c = measure.chroma;
    let total = 0;
    for (let i = 0; i < 12; i++) total += c[i];
    if (total <= 0) return { modeMajor: null, key: null };
    const norm = Array.from(c, (v) => v / total);

    const correlate = (profile, shift) => {
        let sp = 0, sn = 0, spp = 0, snn = 0, spn = 0;
        for (let i = 0; i < 12; i++) {
            const p = profile[(i - shift + 12) % 12];
            const x = norm[i];
            sp += p; sn += x; spp += p * p; snn += x * x; spn += p * x;
        }
        const num = 12 * spn - sp * sn;
        const den = Math.sqrt((12 * spp - sp * sp) * (12 * snn - sn * sn));
        return den > 0 ? num / den : 0;
    };

    let bestMajor = -2, bestMinor = -2, majorKey = 0, minorKey = 0;
    for (let shift = 0; shift < 12; shift++) {
        const maj = correlate(MAJOR_PROFILE, shift);
        const min = correlate(MINOR_PROFILE, shift);
        if (maj > bestMajor) { bestMajor = maj; majorKey = shift; }
        if (min > bestMinor) { bestMinor = min; minorKey = shift; }
    }
    const key = bestMajor >= bestMinor ? majorKey : minorKey;
    /* Map the difference in correlation onto 0..1 — 0.5 is "can't tell". */
    const modeMajor = Math.max(0, Math.min(1, 0.5 + (bestMajor - bestMinor) * 1.5));
    return { modeMajor: Math.round(modeMajor * 1000) / 1000, key };
}

function percentile(sorted, p) {
    if (sorted.length === 0) return null;
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1))));
    return sorted[idx];
}

/** The measurement so far, in the shape the backend expects. */
function featuresSnapshot() {
    if (!measure || measure.frames === 0) return null;
    const n = measure.frames;
    const rmsMean = measure.rmsLinear / n;
    const sorted = measure.rmsDb.slice().sort((a, b) => a - b);
    const p10 = percentile(sorted, 0.1);
    const p95 = percentile(sorted, 0.95);
    const vocalMean = measure.vocal / n;
    const vocalVar = Math.max(0, measure.vocalSq / n - vocalMean * vocalMean);
    const { modeMajor, key } = modeAndKey();
    return {
        seconds: Math.round((n / ANALYSIS_HZ) * 10) / 10,
        frames: n,
        loudness_db: round(measure.loud / n, 2),
        crest_db: round(20 * Math.log10(Math.max(measure.peak, 1e-5) / Math.max(rmsMean, 1e-5)), 2),
        dynamic_range_db: p10 !== null && p95 !== null ? round(p95 - p10, 2) : null,
        centroid_hz: round(measure.centroid / n, 1),
        rolloff_hz: round(measure.rolloff / n, 1),
        flatness: round(measure.flatness / n, 4),
        flux: round(measure.flux / n, 4),
        lf_ratio: round(measure.lf / n, 4),
        vocal_ratio: round(vocalMean, 4),
        vocal_modulation: round(vocalVar, 5),
        hf_ratio: round(measure.hf / n, 4),
        tempo_bpm: measure.tempo,
        beat_strength: measure.beatStrength,
        mode_major: modeMajor,
        key,
    };
}

function round(v, digits) {
    if (!Number.isFinite(v)) return null;
    const f = Math.pow(10, digits);
    return Math.round(v * f) / f;
}

function emitFeatures(final = false) {
    const snapshot = featuresSnapshot();
    if (!snapshot || !measure?.trackId) return;
    send('features', { trackId: measure.trackId, final, ...snapshot });
    lastFeaturesAt = Date.now();
}

function analysisStep() {
    const analyser = audioContextManager?.getAnalyser?.();
    const ctx = audioContextManager?.getAudioContext?.();
    const el = currentElement();
    if (!analyser || !ctx || !el || el.paused) return;

    try {
        analyseFrame(analyser, ctx, el);
    } catch (e) {
        /* A transient graph state (a swapped element mid-crossfade) is not
           worth stopping the whole analysis for. */
        return;
    }

    if (measure && analysisTick % (ANALYSIS_HZ * 2) === 0) estimateTempo();
    if (measure && Date.now() - lastFeaturesAt >= FEATURES_EVERY_MS) emitFeatures(false);
}

function startSpectrum() {
    if (analysisTimer) return;
    analysisTimer = setInterval(analysisStep, Math.round(1000 / ANALYSIS_HZ));
}

function stopSpectrum() {
    if (analysisTimer) {
        clearInterval(analysisTimer);
        analysisTimer = null;
    }
}

/* ------------------------------------------------------------------ */
/* Sound Signature — one correction from three sources                */
/* ------------------------------------------------------------------ */

/*
 * The equaliser used to be a fight between things that wanted the same
 * filters: a headphone correction, the adaptive stabiliser, and whatever the
 * listener set by hand. Now they are *layers*, summed into one curve:
 *
 *   manual    the listener's own bands, exactly as the engine stores them
 *   device    the correction for whatever is playing the sound — matched
 *             from the AutoEQ database by the output device's name, or
 *             chosen by hand — remembered per device and re-applied the
 *             moment that device comes back
 *   track     the adaptive stabiliser's correction for the record playing
 *             now, measured live from the analyser
 *   loudness  equal-loudness compensation: the quieter the volume, the more
 *             the ear loses bass and a little treble, so a gentle shelf is
 *             added back as the volume comes down
 *
 * The sum goes to the running filters through `applyTransientGains`, which
 * never writes to the engine's storage. The manual layer therefore stays
 * exactly what the listener saved, and every automatic layer is reversible
 * by switching it off.
 */

/**
 * Corrections computed by a given generation of the band mapping.
 *
 * A saved profile holds the finished gains, not the measurement, so a profile
 * written by an older mapping keeps being reapplied for ever - the listener
 * would have gone on hearing the bad curve however well this code was fixed.
 * Bump this whenever the mapping changes and stale profiles are recomputed
 * from the measurement instead of trusted.
 */
const CORRECTION_GENERATION = 2;

const SIGNATURE_KEY = 'auralflow-signature';
const DEVICE_PROFILES_KEY = 'auralflow-signature-devices';
const LAYER_LIMIT_DB = 12;

const signature = {
    enabled: true,
    loudnessOn: true,
    /* Off until asked for. Matching a headphone by the name the operating
       system gives an output is a guess, and a wrong correction sounds far
       worse than none at all. */
    autoDevice: false,
    /* The output device, as far as the webview can tell. */
    device: {
        id: '',
        label: '',
        kind: 'unknown',   // headphones | speakers | unknown
        correction: null,  // dB per band
        headphone: null,   // AutoEQ entry the correction came from
        target: null,
        source: 'none',    // none | auto | manual | profile
        message: null,
    },
    track: null,
    loudness: null,
    composed: null,
    lastVolume: 1,
};

function loadSignaturePrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(SIGNATURE_KEY) || 'null');
        if (raw && typeof raw === 'object') {
            if (typeof raw.enabled === 'boolean') signature.enabled = raw.enabled;
            if (typeof raw.loudnessOn === 'boolean') signature.loudnessOn = raw.loudnessOn;
            /* Automatic device matching used to default to on, and with the
               old band mapping behind it that was a bad curve nobody asked
               for. A preference carried over from then is not a choice, so
               take it only once it has been written by this generation. */
            if (raw.generation === CORRECTION_GENERATION && typeof raw.autoDevice === 'boolean') {
                signature.autoDevice = raw.autoDevice;
            }
        }
    } catch {
        /* nothing stored */
    }
}

function saveSignaturePrefs() {
    try {
        localStorage.setItem(
            SIGNATURE_KEY,
            JSON.stringify({
                enabled: signature.enabled,
                loudnessOn: signature.loudnessOn,
                autoDevice: signature.autoDevice,
                generation: CORRECTION_GENERATION,
            })
        );
    } catch {
        /* storage unavailable */
    }
}

function loadDeviceProfiles() {
    try {
        const raw = JSON.parse(localStorage.getItem(DEVICE_PROFILES_KEY) || '{}');
        if (!raw || typeof raw !== 'object') return {};
        const current = {};
        for (const [key, profile] of Object.entries(raw)) {
            if (profile?.generation === CORRECTION_GENERATION) current[key] = profile;
        }
        return current;
    } catch {
        return {};
    }
}

function saveDeviceProfile(key, profile) {
    if (!key) return;
    const profiles = loadDeviceProfiles();
    if (profile) profiles[key] = { ...profile, generation: CORRECTION_GENERATION };
    else delete profiles[key];
    try {
        localStorage.setItem(DEVICE_PROFILES_KEY, JSON.stringify(profiles));
    } catch {
        /* storage unavailable */
    }
}

function deviceKey() {
    return signature.device.label || signature.device.id || 'default';
}

/** Headphones, speakers, or no idea — from the device's name. */
function classifyDevice(label) {
    const l = String(label || '').toLowerCase();
    if (!l) return 'unknown';
    if (/headphone|headset|earbud|earphone|airpod|buds|iem|in-ear|wh-|wf-|momentum|hd ?\d{3}|dt ?\d{3}|arctis|quietcomfort|qc\d/.test(l)) return 'headphones';
    if (/speaker|monitor|hdmi|displayport|soundbar|built-in output|internal speakers/.test(l)) return 'speakers';
    return 'unknown';
}

/**
 * Equal-loudness compensation as a curve over the EQ's own bands.
 *
 * Quiet playback loses bass first and a little treble after; the boost here
 * grows with the attenuation below full volume and tapers to nothing above
 * about 500 Hz for the bass shelf and below 6 kHz for the treble one.
 */
function loudnessCurve(volume, freqs) {
    if (!signature.loudnessOn || !Array.isArray(freqs) || freqs.length === 0) return null;
    const v = Math.max(0.01, Math.min(1, Number(volume) || 0));
    const attenuation = -20 * Math.log10(v); // dB below full
    if (attenuation < 3) return null;
    const bass = Math.min(9, (attenuation - 3) * 0.3);
    const treble = Math.min(3, (attenuation - 3) * 0.1);
    return freqs.map((hz) => {
        let gain = 0;
        if (hz <= 80) gain += bass;
        else if (hz < 500) gain += bass * (1 - Math.log2(hz / 80) / Math.log2(500 / 80));
        if (hz >= 12000) gain += treble;
        else if (hz > 6000) gain += treble * (Math.log2(hz / 6000) / Math.log2(12000 / 6000));
        return Math.round(gain * 100) / 100;
    });
}

/**
 * The level the listener is actually hearing, 0-1.
 *
 * The engine keeps no `volume` on the player at all. Where Web Audio drives
 * the output - everywhere except Safari - it pins the media element to unity
 * and sends the real level to the gain node, so `element.volume` reads 1.0
 * wherever the slider sits. Believing it means the loudness layer thinks the
 * room is always at full tilt, and never engages.
 *
 * `getEffectiveVolume` is what the engine itself applies: the listener's level
 * through the optional exponential curve, scaled by ReplayGain. That is the
 * right signal for equal-loudness compensation, which follows output level
 * rather than slider position.
 */
function currentVolume() {
    try {
        const effective = player?.getEffectiveVolume?.(player.currentRgValues);
        if (Number.isFinite(effective)) return effective;
    } catch { /* fall through to the cruder reads below */ }

    /* Nearest truth first: the gain the graph is running, then the raw
       slider, then the element - which is only meaningful on the native
       volume path, where the graph is the one pinned to unity. */
    const fromGraph = Number(audioContextManager?.currentVolume);
    if (Number.isFinite(fromGraph)) return fromGraph;

    const fromPlayer = Number(player?.userVolume);
    if (Number.isFinite(fromPlayer)) return fromPlayer;

    const el = currentElement();
    return el && Number.isFinite(el.volume) ? el.volume : signature.lastVolume;
}

/** Sum the layers and push them to the running filters. */
function composeSignature(ramp = 0.15) {
    const freqs = adaptiveBands();
    if (!freqs) return;
    const n = freqs.length;
    const manual = (audioContextManager?.getGains?.() ?? []).map(Number);
    const sum = new Array(n).fill(0);
    for (let i = 0; i < n; i++) sum[i] = Number(manual[i]) || 0;

    const layers = [];
    if (signature.enabled) {
        if (signature.device.correction) layers.push(signature.device.correction);
        if (signature.track) layers.push(signature.track);
        signature.loudness = loudnessCurve(currentVolume(), freqs);
        if (signature.loudness) layers.push(signature.loudness);
    } else {
        signature.loudness = null;
    }
    for (const layer of layers) {
        for (let i = 0; i < n; i++) sum[i] += Number(layer[i]) || 0;
    }
    for (let i = 0; i < n; i++) {
        sum[i] = Math.max(-LAYER_LIMIT_DB, Math.min(LAYER_LIMIT_DB, Math.round(sum[i] * 100) / 100));
    }

    /* Automatic layers need the chain live to do anything. */
    if (layers.length > 0 && audioContextManager?.isEQEnabled === false) {
        try { audioContextManager.toggleEQ(true); } catch { /* engine decides */ }
    }
    signature.composed = sum;
    audioContextManager.applyTransientGains(sum, ramp);
}

/**
 * The band gains an AutoEQ correction produces, aligned to the EQ's bands.
 *
 * AutoEQ describes a correction as peaking filters - a centre frequency, a
 * gain and a Q - and those filters overlap. What a band of our equaliser has
 * to carry is therefore the *combined response* of every filter at that band's
 * centre, which is what `calculateBiquadResponse` computes.
 *
 * Dropping each filter's peak gain into the nearest band instead, which is
 * what this did before, is wrong twice over. Filters that sit close together
 * add up: AutoEq's HD 600 correction ends with three separate +3 dB filters at
 * 6950 Hz, which became a single +9 dB band. And a filter's skirt, which is
 * most of its effect, is discarded: a +14.8 dB lift at 20 Hz landed entirely
 * on the 25 Hz band and contributed nothing at 40 or 63 Hz, where the same
 * filter really gives +7.2 and +3.8.
 *
 * On that HD 600 correction the old mapping was off by -7.2 dB at 40 Hz and
 * put a 4.9 dB notch at 4 kHz that the real filters do not have - a hole
 * straight through the middle of every voice, under a wall of sub-bass.
 */
function bandsToGains(bands, freqs) {
    if (!Array.isArray(bands) || !Array.isArray(freqs)) return null;

    /* Anything carrying a centre frequency is a filter and gets evaluated.
       A missing Q means roughly one octave, which is the width AutoEQ falls
       back to itself when it cannot find the skirt of a peak. */
    const isFilters = bands.every((b) => b && Number.isFinite(Number(b.frequency ?? b.freq)));

    if (isFilters) {
        const sampleRate = Number(audioContextManager?.getAudioContext?.()?.sampleRate) || 48000;
        /* `enabled` is not decoration: the engine's response function returns
           a flat zero for a filter that does not carry it. */
        const filters = bands.map((b) => ({
            type: b.type || 'peaking',
            freq: Number(b.frequency ?? b.freq),
            gain: Number(b.gain) || 0,
            q: Number(b.q ?? b.Q) || Math.SQRT2,
            enabled: true,
        }));
        const gains = freqs.map((f) =>
            filters.reduce((sum, filter) => sum + calculateBiquadResponse(f, filter, sampleRate), 0)
        );
        return gains.map((g) => Math.round(g * 100) / 100);
    }

    /* A plain list of per-band gains, already aligned. */
    const gains = new Array(freqs.length).fill(0);
    for (let i = 0; i < Math.min(bands.length, freqs.length); i++) {
        gains[i] = Number(bands[i]?.gain ?? bands[i]) || 0;
    }
    return gains.map((g) => Math.round(g * 100) / 100);
}

async function correctionFor(entry, targetId) {
    const target = TARGETS.find((t) => t.id === String(targetId)) ?? TARGETS[0];
    const measurement = await fetchHeadphoneData(entry);
    if (!Array.isArray(measurement) || measurement.length === 0) {
        throw new Error('That measurement could not be fetched.');
    }
    const freqs = adaptiveBands() ?? [];
    const bands = runAutoEqAlgorithm(measurement, target.data, freqs.length || 10);
    const gains = bandsToGains(bands, freqs);
    if (!gains) throw new Error('No correction could be computed for this pairing.');

    /* AutoEQ publishes a correction alongside a negative preamp, because the
       correction is mostly boost and would otherwise clip. We have no preamp
       of our own to spend here - the listener's is theirs - so centre the
       curve on its own mean instead. The shape, which is the whole point of
       the correction, is untouched; what goes away is the several dB of
       loudness that made every headphone profile sound like someone had
       simply turned it up and leaned on the bass. */
    const mean = gains.reduce((a, b) => a + b, 0) / (gains.length || 1);
    const centred = gains.map((g) => Math.round((g - mean) * 100) / 100);

    return { gains: centred, target, preamp: Math.round(-mean * 10) / 10 };
}

/** Apply a headphone correction to the device layer and remember it. */
async function applyDeviceCorrection(entry, targetId, source) {
    const { gains, target } = await correctionFor(entry, targetId);
    signature.device.correction = gains;
    signature.device.headphone = {
        name: String(entry.name ?? ''),
        type: String(entry.type ?? ''),
        path: String(entry.path ?? ''),
        fileName: String(entry.fileName ?? ''),
    };
    signature.device.target = target.id;
    signature.device.source = source;
    signature.device.message = null;
    saveDeviceProfile(deviceKey(), {
        label: signature.device.label,
        headphone: signature.device.headphone,
        target: target.id,
        gains,
        source,
    });
    composeSignature(0.3);
}

function clearDeviceCorrection(forget = true) {
    signature.device.correction = null;
    signature.device.headphone = null;
    signature.device.target = null;
    signature.device.source = 'none';
    if (forget) saveDeviceProfile(deviceKey(), null);
    composeSignature(0.2);
}

/** Tokens from a device name that would identify it in the AutoEQ index. */
function matchTokens(label) {
    return String(label || '')
        .toLowerCase()
        .replace(/\(.*?\)/g, ' ')
        .replace(/[^a-z0-9+ -]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !/^(the|and|for|with|audio|stereo|output|default|hands-free|handsfree|ag|a2dp|sink|analog|digital|usb|bluetooth|bt|device|monitor)$/.test(t));
}

/**
 * Find the AutoEQ entry that best matches an output device's name.
 *
 * Only a match where every distinctive token of the device name appears in
 * the entry's name is trusted — "Sony WH-1000XM4" must not become the XM3.
 */
async function autoMatchDevice() {
    const label = signature.device.label;
    const tokens = matchTokens(label);
    if (tokens.length === 0) return null;
    const index = await fetchAutoEqIndex().catch(() => null);
    const entries = searchHeadphones(tokens.join(' '), index || POPULAR_HEADPHONES, 'all', 40) || [];
    const modelTokens = tokens.filter((t) => /\d/.test(t) || t.length >= 4);
    for (const entry of entries) {
        const name = String(entry.name ?? '').toLowerCase();
        if (modelTokens.length > 0 && modelTokens.every((t) => name.includes(t))) return entry;
    }
    return null;
}

/**
 * The output device changed (or was just discovered). Restore the profile
 * we have for it; failing that, try to match it in AutoEQ; failing that,
 * run with no device correction and say so.
 */
async function onDeviceResolved() {
    const profiles = loadDeviceProfiles();
    const profile = profiles[deviceKey()];
    if (profile?.gains) {
        signature.device.correction = profile.gains;
        signature.device.headphone = profile.headphone ?? null;
        signature.device.target = profile.target ?? null;
        signature.device.source = 'profile';
        signature.device.message = null;
        composeSignature(0.3);
        emitSignature();
        return;
    }

    signature.device.correction = null;
    signature.device.headphone = null;
    signature.device.target = null;
    signature.device.source = 'none';
    signature.device.message = null;
    composeSignature(0.3);
    emitSignature();

    if (!signature.autoDevice || !signature.device.label) return;

    /* Only guess for something we are confident is headphones. A correction
       measured in an ear cup makes no sense over speakers, and matching a
       model name out of a sound-card label is a guess that sounds terrible
       when it is wrong. Picking one by hand is always still available. */
    if (signature.device.kind !== 'headphones') {
        signature.device.message =
            signature.device.kind === 'speakers'
                ? `"${signature.device.label}" looks like speakers, so no headphone correction was applied. Pick one by hand if that is wrong.`
                : `"${signature.device.label}" could not be identified as headphones, so nothing was applied automatically. Pick your model by hand to correct for it.`;
        emitSignature();
        return;
    }

    try {
        const entry = await autoMatchDevice();
        if (entry) {
            await applyDeviceCorrection(entry, TARGETS[0]?.id, 'auto');
        } else {
            signature.device.message = `No AutoEQ measurement matches "${signature.device.label}". Pick one by hand if you know the model.`;
        }
    } catch (e) {
        signature.device.message = String(e?.message ?? e);
    }
    emitSignature();
}

/* ---- Output devices ---- */

const devices = {
    supported: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.enumerateDevices),
    list: [],
    labelsAvailable: false,
    current: '',
};

async function refreshDevices(requestLabels = false) {
    if (!devices.supported) {
        emitDevices();
        return;
    }
    if (requestLabels) {
        /* Labels are withheld until a media permission is granted; asking for
           a microphone stream and releasing it immediately is the standard
           way to unlock them. Only on an explicit request from the shell. */
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            for (const track of stream.getTracks()) track.stop();
        } catch {
            /* denied — labels stay hidden */
        }
    }
    try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const outputs = all.filter((d) => d.kind === 'audiooutput');
        devices.list = outputs.map((d, i) => ({
            id: d.deviceId,
            label: d.label || (d.deviceId === 'default' ? 'System default' : `Output ${i + 1}`),
            kind: classifyDevice(d.label),
        }));
        devices.labelsAvailable = outputs.some((d) => Boolean(d.label));
    } catch {
        devices.list = [];
    }
    const el = currentElement() ?? player?.audioElements?.[0];
    devices.current = String(el?.sinkId ?? '');
    syncDeviceFromList();
    emitDevices();
}

/** Reflect the selected sink onto the signature's notion of the device. */
function syncDeviceFromList() {
    const chosen =
        devices.list.find((d) => d.id === devices.current) ||
        devices.list.find((d) => d.id === 'default') ||
        devices.list[0];
    const label = chosen?.label ?? '';
    const id = chosen?.id ?? '';
    const changed = label !== signature.device.label || id !== signature.device.id;
    signature.device.id = id;
    signature.device.label = signature.device.source === 'manual' && !changed ? signature.device.label : label;
    signature.device.kind = classifyDevice(signature.device.label);
    if (changed) void onDeviceResolved();
}

async function selectDevice(id) {
    const elements = player?.audioElements ?? [];
    let applied = false;
    for (const el of elements) {
        if (typeof el.setSinkId === 'function') {
            await el.setSinkId(id);
            applied = true;
        }
    }
    const ctx = audioContextManager?.getAudioContext?.();
    if (ctx && typeof ctx.setSinkId === 'function') {
        try { await ctx.setSinkId(id === 'default' ? '' : id); applied = true; } catch { /* not every backend can */ }
    }
    if (!applied) throw new Error('This platform does not let the app choose an output device.');
    devices.current = id;
    syncDeviceFromList();
    emitDevices();
}

function emitDevices() {
    send('devices', {
        supported: devices.supported,
        labelsAvailable: devices.labelsAvailable,
        current: devices.current,
        devices: devices.list.map((d) => ({ ...d, current: d.id === devices.current })),
    });
}

function readSignature() {
    return {
        enabled: signature.enabled,
        loudnessOn: signature.loudnessOn,
        autoDevice: signature.autoDevice,
        device: { ...signature.device },
        track: signature.track,
        loudness: signature.loudness,
        manual: (audioContextManager?.getGains?.() ?? []).map(Number),
        composed: signature.composed,
        frequencies: adaptiveBands() ?? [],
        volume: currentVolume(),
    };
}

function emitSignature() {
    send('signature', readSignature());
}

function initSignature() {
    loadSignaturePrefs();
    if (devices.supported && navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => void refreshDevices(false));
    }
    void refreshDevices(false);
    /* The volume can change under us (engine UI, keyboard); keep the
       loudness layer honest without waiting for a command. */
    setInterval(() => {
        const v = currentVolume();
        if (Math.abs(v - signature.lastVolume) > 0.005) {
            signature.lastVolume = v;
            composeSignature(0.2);
            emitSignature();
        }
    }, 1000);
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
            if (Number.isFinite(level)) {
                player.setVolume(Math.max(0, Math.min(1, level)));
                /* Read back rather than trusting the commanded level: what
                   reaches the output is scaled by ReplayGain and the volume
                   curve, and the poll below compares against that. */
                signature.lastVolume = currentVolume();
                composeSignature(0.2);
                emitSignature();
            }
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
                /* The shell's index came from the last queue event it saw. If
                   the engine has moved on since - a track ended, the DJ queued
                   its pick - that index now points at a different track, and
                   splicing it would drop the wrong one. Where the caller says
                   which track it meant, the id is the truth and the index is
                   only a hint. */
                const queue = player.getCurrentQueue?.() ?? [];
                const id = data.id == null ? null : String(data.id);
                let index = Number(data.index);
                if (id !== null && String(queue[index]?.id ?? '') !== id) {
                    index = queue.findIndex((t) => t && String(t.id) === id);
                }
                if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
                    /* Already gone. Re-send the queue so the shell catches up. */
                    send('queue', readQueue());
                    break;
                }
                await player.removeFromQueue(index);
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
                    /* The hand-set curve is the base layer; the automatic
                       layers are summed on top of whatever it becomes. */
                    audioContextManager.setAllGains(data.gains.map(Number));
                }
                if (data.preamp !== undefined) {
                    audioContextManager.setPreamp(Number(data.preamp) || 0);
                }
                composeSignature(0.1);
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

                /* The correction becomes the device layer of the Sound
                   Signature, so it stacks with the stabiliser and the
                   listener's own curve instead of replacing them. */
                await applyDeviceCorrection(entry, target.id, 'manual');
                send('autoeq', {
                    applied: true,
                    headphone: String(entry.name ?? ''),
                    target: target.label,
                    bands: signature.device.correction?.length ?? 0,
                });
                emitSignature();
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

            /* The engine's CSV parser splits on commas only, so hand it
               commas whatever the export actually used. */
            if (parser === parsers.csv) source = normalizeDelimiter(source);

            const onProgress = (p) => {
                send('importprogress', {
                    current: Number(p?.current) || 0,
                    total: Number(p?.total) || 0,
                    item: String(p?.currentItem ?? p?.item ?? ''),
                    /* Absent for the formats that resolve in one pass; the
                       shell leaves its count alone rather than showing zero. */
                    matched: Number.isFinite(p?.matched) ? Number(p.matched) : null,
                });
            };

            /* Every lookup the parser makes goes through here, so a
               catalogue that is down is reported as a catalogue that is down.
               Otherwise each failed request is swallowed row by row and the
               import ends up claiming the catalogue has none of your music.
               `searchTracksByIsrc` is deliberately absent, exactly as it is on
               the engine's own API object: the parser probes for it, falls
               back, and verifies ISRCs against the search results instead. */
            let lookups = 0;
            let failures = 0;
            let lastLookupError = null;
            const counted = (fn) => async (...args) => {
                lookups++;
                try {
                    return await fn(...args);
                } catch (e) {
                    failures++;
                    lastLookupError = e;
                    throw e;
                }
            };
            const catalogue = {
                searchTracks: counted((...a) => api.searchTracks(...a)),
                searchAlbums: counted((...a) => api.searchAlbums(...a)),
                searchArtists: counted((...a) => api.searchArtists(...a)),
            };

            try {
                /* The parsers hit the catalogue once per row and pace
                   themselves to stay under its rate limit. */
                const result =
                    parser === parsers.csv
                        ? await parseCsvInBatches(source, catalogue, onProgress, parsers.csv)
                        : await parser(source, catalogue, onProgress);
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

                /* Rows were read but none carried a title or an artist, which
                   means the columns were not recognised - not that the
                   catalogue is missing your music. Reporting these as "not
                   found" is how a header mismatch masquerades as a library
                   with nothing in it, so name the real problem. */
                if (tracks.length === 0 && missing.every((m) => !m.title && !m.artist)) {
                    const header = String(source.split(/\r?\n/)[0] ?? '').slice(0, 300);
                    send('importdone', {
                        error:
                            `Read ${missing.length} rows, but no track or artist column was ` +
                            `recognised, so there was nothing to look up. The first line reads: ` +
                            `${header}`,
                    });
                    break;
                }

                /* Nothing matched and nothing the catalogue was asked for
                   came back. That is an unreachable catalogue, not a library
                   it has never heard of. */
                if (tracks.length === 0 && lookups > 0 && failures === lookups) {
                    send('importdone', {
                        error:
                            `The catalogue could not be reached, so none of the ${missing.length} ` +
                            `tracks could be looked up. ${String(lastLookupError?.message ?? lastLookupError ?? '')}`.trim(),
                    });
                    break;
                }

                send('importdone', { tracks, playlists, missing });
            } catch (e) {
                send('importdone', { error: String(e?.message ?? e) });
            }
            break;
        }

        case 'devices': {
            /* Output devices the webview can see, and which one is in use. */
            try {
                await refreshDevices(Boolean(data.requestLabels));
            } catch (e) {
                send('error', { scope: 'devices', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'setdevice': {
            try {
                await selectDevice(String(data.id ?? ''));
            } catch (e) {
                send('error', { scope: 'setdevice', message: String(e?.message ?? e) });
                emitDevices();
            }
            break;
        }

        case 'signature': {
            /* The Sound Signature layers: switch them, name the device by
               hand, choose a correction, or forget one. */
            try {
                let recompose = false;
                if (data.enabled !== undefined) { signature.enabled = Boolean(data.enabled); recompose = true; }
                if (data.loudness !== undefined) { signature.loudnessOn = Boolean(data.loudness); recompose = true; }
                if (data.autoDevice !== undefined) { signature.autoDevice = Boolean(data.autoDevice); }
                saveSignaturePrefs();

                if (typeof data.deviceLabel === 'string') {
                    /* A device named by the listener, for platforms that hide
                       labels or when the OS name is useless. */
                    signature.device.label = data.deviceLabel.trim();
                    signature.device.kind = classifyDevice(signature.device.label);
                    signature.device.source = 'manual';
                    await onDeviceResolved();
                    break;
                }
                if (data.clearDevice) {
                    clearDeviceCorrection(true);
                } else if (data.headphone) {
                    if (adaptive.on && signature.track) { /* layers coexist now; nothing to stop */ }
                    await applyDeviceCorrection(data.headphone, data.target, 'manual');
                } else if (recompose) {
                    composeSignature(0.2);
                }
                emitSignature();
            } catch (e) {
                signature.device.message = String(e?.message ?? e);
                emitSignature();
                send('error', { scope: 'signature', message: String(e?.message ?? e) });
            }
            break;
        }

        case 'features': {
            /* The measurement so far for the playing track, on demand. */
            emitFeatures(false);
            break;
        }

        case 'ping':
            send('pong');
            break;

        case 'hello':
            /* The shell attached its listener after we announced ourselves
               (or reloaded). Announce again so it can connect. */
            send('ready', {
                version: 3,
                playbackConfigured: await playbackAvailable(),
                preferAtmos: (() => {
                    try {
                        return preferDolbyAtmosSettings.isEnabled();
                    } catch {
                        return false;
                    }
                })(),
            });
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
        initSignature();

        /* Say we are ready the moment we are.
         *
         * Whether a playback backend answers is a question for the network,
         * and answering it takes up to fourteen seconds between the instance
         * list and the health probe. Waiting for it here held `ready` back and
         * left the whole app sitting on "Starting the audio engine" for that
         * long on every single launch, with a player that had in fact been
         * ready the whole time.
         *
         * So report readiness now, and let the probe follow with
         * `playbackconfig` when it knows. */
        send('ready', {
            version: 3,
            playbackConfigured: null,
            preferAtmos: (() => {
                try {
                    return preferDolbyAtmosSettings.isEnabled();
                } catch {
                    return false;
                }
            })(),
        });

        /* The engine restores its own queue, current track, shuffle and repeat
           from storage when it starts. Nothing was ever asking it for them, so
           every launch looked like an empty queue and the shell then pushed
           its own defaults back over the restored ones. Hand them over now,
           before anything is mirrored the other way. */
        send('queue', readQueue());
        send('shuffle', { enabled: Boolean(player.shuffleActive) });
        send('repeat', {
            mode:
                player.repeatMode === REPEAT_MODE.ALL
                    ? 'all'
                    : player.repeatMode === REPEAT_MODE.ONE
                      ? 'one'
                      : 'off',
        });

        void playbackAvailable()
            .then((configured) => send('playbackconfig', { configured }))
            .catch(() => send('playbackconfig', { configured: false }));
    } catch (e) {
        send('error', { scope: 'boot', message: String(e?.message ?? e) });
    }
}

/* Only run inside the AuralFlow shell, never when Monochrome is opened directly. */
if (window.parent && window.parent !== window) {
    void boot();
}
