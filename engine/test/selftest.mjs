/* Exercise the bridge analysis and Sound Signature code against a synthetic audio graph.
   Run from the repo root:  node engine/test/selftest.mjs  — needs no vendored engine. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

let src = readFileSync("engine/auralflow-bridge.js", "utf8");
src = src.replace(/^import[\s\S]*?from '.*?';$/gm, "");
src = src.replace("if (window.parent && window.parent !== window) {\n    void boot();\n}", "");
src += `
globalThis.__t = { analyseFrame, estimateTempo, featuresSnapshot, resetMeasurement, loudnessCurve, bandsToGains,
  classifyDevice, composeSignature, matchTokens, signature, adaptiveBands, get measure() { return measure; }, set measure(v) { measure = v; },
  setPlayer(p) { player = p; }, modeAndKey };
`;

const sent = [];
const FFT = 2048;
const SR = 48000;
const binHz = SR / 2 / (FFT / 2);

// Synthetic signal: a 120 BPM click train under a C major chord, rendered per frame.
let t = 0;
const analyser = {
  fftSize: FFT, frequencyBinCount: FFT / 2, minDecibels: -100, maxDecibels: -30,
  getByteFrequencyData(bins) {
    const beat = 60 / 120;
    const phase = (t % beat) / beat;
    const hit = phase < 0.08 ? 1 : 0.25; // click at the beat
    for (let k = 0; k < bins.length; k++) {
      const f = k * binHz;
      let db = -95 - 8 * Math.log2(Math.max(f, 30) / 30); // natural roll-off
      for (const note of [261.6, 329.6, 392.0, 523.3, 659.3]) {
        for (let h = 1; h <= 4; h++) if (Math.abs(f - note * h) <= binHz / 2) db = Math.max(db, -45 - 6 * h);
      }
      if (f > 1000 && f < 6000) db = Math.max(db, -80 + 40 * hit); // broadband click
      db = Math.max(-100, Math.min(-30, db));
      bins[k] = Math.round(((db + 100) / 70) * 255);
    }
  },
  getByteTimeDomainData(samples) {
    const beat = 60 / 120;
    const phase = (t % beat) / beat;
    const amp = phase < 0.08 ? 0.6 : 0.2;
    for (let i = 0; i < samples.length; i++) samples[i] = 128 + Math.round(amp * 127 * Math.sin(i / 7));
  },
};
const ctx = { sampleRate: SR };
const el = { paused: false, currentTime: 0, duration: 200, volume: 1 };
const gains = new Array(16).fill(0);
const audioContextManager = {
  frequencies: [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 12500, 16000],
  getAnalyser: () => analyser, getAudioContext: () => ctx, getGains: () => gains, isEQEnabled: true,
  toggleEQ() {}, applyTransientGains(g) { globalThis.__applied = g; },
};
const store = {};
const sandbox = {
  console, Math, Number, Array, Float32Array, Float64Array, Uint8Array, Date, JSON, Map, Set, Promise, setInterval: () => 0, clearInterval() {}, setTimeout, String, Boolean, Object, Error, DOMParser: class {},
  window: { parent: { postMessage(m) { sent.push(m); } }, addEventListener() {} },
  navigator: { mediaDevices: null, platform: "Linux" },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
  fetch: async () => ({ ok: false }), AbortSignal: { timeout: () => null },
  audioContextManager, Player: {}, MusicAPI: {}, LyricsManager: {}, TARGETS: [{ id: "harman", label: "Harman", data: [] }],
  POPULAR_HEADPHONES: [], REPEAT_MODE: {}, unifiedPlaybackSettings: {}, deezerFallbackSettings: {}, preferDolbyAtmosSettings: {}, downloadQualitySettings: {}, apiSettings: {},
  runAutoEqAlgorithm: () => [], fetchAutoEqIndex: async () => [], fetchHeadphoneData: async () => [], searchHeadphones: () => [], getPresetsForBandCount: () => ({}),
  downloadTrackWithMetadata() {}, downloadTracks() {}, parseDynamicCSV() {}, parseJSPF() {}, parseXSPF() {}, parseXML() {}, parseM3U() {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const T = sandbox.__t;

T.setPlayer({ activeElement: el, volume: 1, audioElements: [el] });
T.resetMeasurement("track-1");
const HZ = 30;
for (let i = 0; i < HZ * 20; i++) { t = i / HZ; el.currentTime = t; T.analyseFrame(analyser, ctx, el); }
T.estimateTempo();
const f = T.featuresSnapshot();
console.log("features", JSON.stringify(f)); console.log("chroma", Array.from(T.measure.chroma).map((v)=>v.toExponential(2)).join(" "));
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };
ok(f.frames === HZ * 20, "all frames counted");
ok(f.tempo_bpm && Math.abs(f.tempo_bpm - 120) < 6, `tempo near 120 (got ${f.tempo_bpm})`);
ok(f.beat_strength > 0.2, `beat strength ${f.beat_strength}`);
ok(f.mode_major > 0.5, `major chord reads major (${f.mode_major})`);
ok(f.key === 0, `key is C (${f.key})`);
ok(f.loudness_db < 0 && f.loudness_db > -30, `loudness ${f.loudness_db}`);
ok(f.crest_db > 0, `crest ${f.crest_db}`);
ok(f.dynamic_range_db > 3, `dynamic range ${f.dynamic_range_db}`);
ok(f.centroid_hz > 200 && f.centroid_hz < 8000, `centroid ${f.centroid_hz}`);
ok(f.flatness >= 0 && f.flatness <= 1, `flatness ${f.flatness}`);
ok(sent.filter((m) => m.type === "af:spectrum").length === HZ * 10, `spectrum at half the analysis rate (${sent.filter((m) => m.type === "af:spectrum").length})`);

const lc = T.loudnessCurve(0.2, audioContextManager.frequencies);
ok(lc && lc[0] > 2 && lc[8] === 0 && lc[15] > 0, `loudness curve at 20% volume ${JSON.stringify(lc)}`);
ok(T.loudnessCurve(1, audioContextManager.frequencies) === null, "no loudness compensation at full volume");
ok(T.classifyDevice("Sony WH-1000XM4 Hands-Free AG Audio") === "headphones", "classifies headphones");
ok(T.classifyDevice("HDMI / DisplayPort 2 Output") === "speakers", "classifies speakers");
ok(JSON.stringify(T.matchTokens("Sony WH-1000XM4 Hands-Free AG Audio")) === JSON.stringify(["sony", "wh-1000xm4"]), "match tokens " + JSON.stringify(T.matchTokens("Sony WH-1000XM4 Hands-Free AG Audio")));
const g = T.bandsToGains([{ frequency: 100, gain: 3 }, { frequency: 10000, gain: -2 }], audioContextManager.frequencies);
ok(g[3] === 3 && g[13] === -2, "bands map to nearest EQ band " + JSON.stringify(g));
gains[0] = 2;
T.signature.track = new Array(16).fill(1);
T.signature.device.correction = new Array(16).fill(0.5);
T.signature.lastVolume = 1;
T.composeSignature();
ok(globalThis.__applied[0] === 3.5 && globalThis.__applied[1] === 1.5, "layers sum onto the manual base " + JSON.stringify(globalThis.__applied));
T.signature.enabled = false;
T.composeSignature();
ok(globalThis.__applied[0] === 2 && globalThis.__applied[1] === 0, "disabled signature leaves only the manual curve");
