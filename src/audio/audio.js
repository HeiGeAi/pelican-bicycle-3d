/**
 * Procedural Web Audio engine for "a pelican riding a bicycle around a
 * tropical island at golden hour". Everything is synthesized at runtime with
 * the Web Audio API: no audio files, no dependencies.
 *
 * Graph: sfx + ambience + music buses → master gain → compressor → output,
 * plus a ConvolverNode reverb (generated impulse response) used as a send.
 */

const TAU = Math.PI * 2;
const MIN = 0.0001; // exponential ramps cannot start from or reach 0
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Music material
// ---------------------------------------------------------------------------

// Ukulele (GCEA, re-entrant) voicings, strings listed top (G) to bottom (A).
const CHORDS = {
  F: { bass: 41, notes: [69, 60, 65, 69] },
  Dm: { bass: 38, notes: [69, 62, 65, 69] },
  Bb: { bass: 46, notes: [70, 62, 65, 70] },
  C: { bass: 36, notes: [67, 60, 64, 72] },
  Am: { bass: 45, notes: [69, 60, 64, 69] },
  C7: { bass: 36, notes: [67, 60, 64, 70] },
};
for (const c of Object.values(CHORDS)) c.pcs = c.notes.map((n) => n % 12);
const UKE_PITCHES = [60, 62, 64, 65, 67, 69, 70, 72];
const PROGRESSIONS = [
  ['F', 'Dm', 'Bb', 'C'], // I–vi–IV–V
  ['F', 'Am', 'Bb', 'C7'], // alternate 8 bars: I–iii–IV–V7
];
// [sixteenth-note step, strum direction, velocity]
const STRUMS = {
  a: [[0, 'D', 1], [4, 'D', 0.75], [6, 'U', 0.5], [10, 'U', 0.45], [12, 'D', 0.7], [14, 'U', 0.5]],
  b: [[0, 'D', 1], [6, 'U', 0.5], [8, 'D', 0.8], [12, 'D', 0.6], [14, 'U', 0.45]],
  night: [[0, 'D', 0.8], [8, 'D', 0.55]],
};
const PENTATONIC = [65, 67, 69, 72, 74, 77, 79, 81, 84, 86]; // F major pentatonic, F4–D6
const WALK = [-2, -1, -1, 0, 1, 1, 2];
const BPM = 92;
const STEP = 60 / BPM / 4;
const SWING = STEP * 0.3;
const LOOKAHEAD = 0.2;
const MUSIC_LEVEL = 0.35;
const STRUM_GAIN = 0.16;
const BASS_GAIN = 0.26;
const MELODY_GAIN = 0.2;
const SHAKER_GAIN = 0.05;

// Modal recipes: [frequency ratio (Hz when f0 = 1), amplitude, T60 s, beat Hz of a detuned pair]
const BELL = [[1, 1, 1.25, 3.1], [2.32, 0.55, 0.95, 4.3], [4.25, 0.32, 0.6, 5.7], [6.63, 0.18, 0.4, 7.9]];
const MARIMBA = [[1, 1, 0.9], [3.93, 0.28, 0.14], [9.2, 0.08, 0.05]];
const GLOCK = [[1, 1, 1.5], [2.76, 0.42, 0.55], [5.4, 0.22, 0.28], [8.93, 0.1, 0.14]];
const TICK = [[3150, 1, 0.012], [5230, 0.6, 0.008], [7890, 0.35, 0.005]];
const CRICKETS = [
  { freq: 4450, pulses: 4, period: 0.021, amp: 0.05, gap: 0.3 },
  { freq: 4720, pulses: 3, period: 0.018, amp: 0.035, gap: 0.38 },
];

// ---------------------------------------------------------------------------
// Offline buffer rendering (runs once, lazily, on the main thread)
// ---------------------------------------------------------------------------

function fadeEdges(d, sr, fadeIn, fadeOut) {
  const n = d.length;
  const a = Math.max(1, Math.floor(sr * fadeIn));
  const b = Math.max(1, Math.floor(sr * fadeOut));
  for (let i = 0; i < a && i < n; i++) d[i] *= i / a;
  for (let i = 0; i < b && i < n; i++) d[n - 1 - i] *= i / b;
}

function normalizePeak(d, target) {
  let m = 1e-9;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  const k = target / m;
  for (let i = 0; i < d.length; i++) d[i] *= k;
}

function normalizeRms(d, target) {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  const k = target / Math.sqrt(s / d.length || 1e-12);
  for (let i = 0; i < d.length; i++) d[i] *= k;
}

function makeNoise(ctx, seconds, rnd) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const fade = Math.floor(sr * 0.05);
  const raw = new Float32Array(len + fade);
  // Renders `len + fade` samples per channel and cross-fades the overflow into
  // the head, so the buffer loops without a seam.
  const make = (channels, rms, fill) => {
    const buf = ctx.createBuffer(channels, len, sr);
    for (let ch = 0; ch < channels; ch++) {
      fill(raw);
      const out = raw.subarray(0, len);
      for (let i = 0; i < fade; i++) {
        const x = i / fade;
        out[i] = raw[i] * Math.sqrt(x) + raw[len + i] * Math.sqrt(1 - x);
      }
      if (rms) normalizeRms(out, rms);
      buf.getChannelData(ch).set(out);
    }
    return buf;
  };
  const white = make(1, 0, (d) => {
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
  });
  // Paul Kellet's pink filter; the two channels are independent for a wide stereo bed.
  const pink = make(2, 0.25, (d) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const x = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + x * 0.0555179;
      b1 = 0.99332 * b1 + x * 0.0750759;
      b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856;
      b4 = 0.55 * b4 + x * 0.5329522;
      b5 = -0.7616 * b5 - x * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362;
      b6 = x * 0.115926;
    }
  });
  const brown = make(1, 0.25, (d) => {
    let last = 0;
    for (let i = 0; i < d.length; i++) d[i] = last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
  });
  return { white, pink, brown };
}

function makeImpulse(ctx, seconds, rt60, rnd) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.012);
  const onset = sr * 0.003;
  const decay = Math.exp(-6.9 / (rt60 * sr));
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    let env = 1;
    for (let i = pre; i < len; i++, env *= decay) {
      const t = (i - pre) / (len - pre);
      lp += (rnd() * 2 - 1 - lp) * (0.85 - 0.65 * t); // tail darkens as it decays
      d[i] = lp * env * Math.min(1, (i - pre) / onset);
    }
    fadeEdges(d, sr, 0, 0.1);
  }
  return buf;
}

// Karplus–Strong plucked string with an allpass fractional delay for accurate tuning.
function renderPluck(ctx, freq, rnd, seconds = 1.3, t60 = 1.25) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, n, sr);
  const out = buf.getChannelData(0);
  const delay = sr / freq - 0.5; // the two-point average adds half a sample
  const N = Math.max(2, Math.floor(delay - 0.1));
  const frac = delay - N;
  const C = (1 - frac) / (1 + frac);
  const line = new Float32Array(N);
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < N; i++) {
    lp += (rnd() * 2 - 1 - lp) * 0.5;
    line[i] = lp;
    mean += lp / N;
  }
  for (let i = 0; i < N; i++) line[i] -= mean;
  const rho = Math.exp(-6.9 / (freq * t60));
  let p = 0, prev = 0, apIn = 0, apOut = 0;
  for (let i = 0; i < n; i++) {
    const x = line[p];
    const avg = 0.5 * (x + prev);
    prev = x;
    apOut = C * avg + apIn - C * apOut;
    apIn = avg;
    line[p] = apOut * rho;
    if (++p === N) p = 0;
    out[i] = x;
  }
  fadeEdges(out, sr, 0.0015, 0.06);
  normalizePeak(out, 0.5);
  return buf;
}

// Sum of exponentially decaying sinusoids, each rendered with a damped
// two-pole resonator recurrence (y[n] = 2r·cos(w)·y[n-1] − r²·y[n-2]).
function renderModes(ctx, f0, modes, seconds, noiseAmt, rnd) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (const [ratio, amp, t60, beat = 0] of modes) {
    const f = f0 * ratio;
    const pair = beat ? [f - beat / 2, f + beat / 2] : [f];
    for (const ff of pair) {
      if (ff >= sr * 0.45) continue;
      const w = (TAU * ff) / sr;
      const r = Math.exp(-6.9 / (t60 * sr));
      const c = 2 * r * Math.cos(w);
      const r2 = r * r;
      let y2 = 0;
      let y1 = (amp / pair.length) * r * Math.sin(w);
      d[1] += y1;
      for (let i = 2; i < n; i++) {
        const y = c * y1 - r2 * y2;
        d[i] += y;
        y2 = y1;
        y1 = y;
      }
    }
  }
  if (noiseAmt > 0) {
    const k = Math.exp(-1 / (sr * 0.002));
    for (let i = 0, e = noiseAmt; i < n && e > 1e-4; i++, e *= k) d[i] += (rnd() * 2 - 1) * e;
  }
  fadeEdges(d, sr, 0.001, Math.min(0.02, seconds * 0.25));
  normalizePeak(d, 0.9);
  return buf;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AudioState
 * @property {number} [dt]          Frame delta in seconds.
 * @property {number} [speed]       Ground speed in m/s (0..12).
 * @property {boolean} [pedaling]   True while the pedals are being pushed.
 * @property {number} [wheelOmega]  Wheel angular velocity in rad/s.
 * @property {boolean} [airborne]   True while the bike is off the ground.
 * @property {number} [night]       0 = golden hour, 1 = full night.
 * @property {number} [nearSea]     0 = inland, 1 = at the shoreline.
 */

/**
 * @typedef {Object} AudioEngine
 * @property {() => Promise<void>} start  Create/resume the context and start ambience + music.
 *   Call from a user-gesture handler; idempotent and never rejects.
 * @property {boolean} started  True once the audio graph exists.
 * @property {(muted: boolean) => void} setMuted  Smoothly ramps the master gain.
 * @property {boolean} muted
 * @property {(enabled: boolean) => void} setMusicEnabled  Fades the generative music in/out.
 * @property {boolean} musicEnabled  Default `true`.
 * @property {(volume: number) => void} setMasterVolume  0..1, default 0.8.
 * @property {(state: AudioState) => void} update  Call once per animation frame.
 * @property {() => void} bell  Bicycle bell "ding-ding".
 * @property {(count?: number) => void} billClap  Pelican bill clatter (default 3 clacks).
 * @property {() => void} gulp  Cartoon swallow.
 * @property {(volume?: number, pan?: number) => void} splash  Water splash.
 * @property {() => void} whoosh  Jump take-off.
 * @property {() => void} thump  Landing.
 * @property {(pan?: number) => void} seagull  Gull call, pan −1..1.
 * @property {() => void} chime  Lap-complete jingle.
 * @property {() => void} shutter  Camera shutter.
 * @property {() => void} pop  Soft UI click.
 * @property {() => void} whistle  Happy up-glide chirp.
 * @property {() => Promise<void>} suspend  Pause the context (e.g. page hidden).
 * @property {() => Promise<void>} resume  Resume after `suspend()`.
 */

/**
 * Creates the procedural audio engine. Nothing is allocated until `start()`
 * runs from a user gesture; every method is a safe no-op before that.
 * @returns {AudioEngine}
 */
export function createAudioEngine() {
  let ctx = null;
  let started = false;
  let muted = false;
  let musicOn = true;
  let volume = 0.8;
  let night = 0;
  let noiseBufs = null;
  let warnedUpdate = false;
  const B = {}; // buses and shared nodes
  const A = {}; // ambience nodes
  const amb = { tick: 0, gull: 0, crickets: [0, 0], slowAt: -1 };
  const music = { timer: 0, stopTimer: 0, step: 0, next: 0, mel: 4, lastStrum: null };
  const buffers = new Map();
  const lastTarget = new Map();
  const rnd = Math.random;
  const mrnd = mulberry32(0x5eab1d);

  const ready = () => started && ctx.state !== 'closed';
  const now = () => ctx.currentTime;
  const disconnect = (node) => {
    try { node.disconnect(); } catch (_) { /* already disconnected */ }
  };

  function gainNode(value, dest) {
    const g = ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    return g;
  }

  function filterNode(type, freq, q, dest) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }

  function panNode(pan, dest) {
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (p.pan) p.pan.value = clamp(pan, -1, 1);
    if (dest) p.connect(dest);
    return p;
  }

  // Smoothly moves an AudioParam, skipping redundant automation events.
  function glide(param, value, tc) {
    const prev = lastTarget.get(param);
    if (prev !== undefined && Math.abs(prev - value) <= 1e-4 + Math.abs(value) * 0.003) return;
    lastTarget.set(param, value);
    param.setTargetAtTime(value, ctx.currentTime, tc);
  }

  // Disconnects a voice's nodes once all of its sources have ended.
  function free(sources, nodes, after) {
    let live = sources.length;
    const end = () => {
      if (--live > 0) return;
      sources.forEach(disconnect);
      nodes.forEach(disconnect);
      if (after) after();
    };
    for (const s of sources) s.onended = end;
  }

  // A per-sound bus (gain → optional pan → dest, optional reverb send) that
  // tears itself down after every source routed into it has finished.
  function voice(dest, { gain = 1, pan = 0, send = 0 } = {}) {
    const input = gainNode(gain);
    const nodes = [input];
    let out = input;
    let panner = null;
    if (pan && ctx.createStereoPanner) {
      panner = panNode(pan);
      out.connect(panner);
      out = panner;
      nodes.push(panner);
    }
    out.connect(dest);
    if (send > 0) {
      const s = gainNode(send, B.reverb);
      out.connect(s);
      nodes.push(s);
    }
    let refs = 0;
    const release = () => {
      if (--refs === 0) nodes.forEach(disconnect);
    };
    return { input, panner, hold: () => (refs++, release) };
  }

  function attach(node, out) {
    if (out && out.hold) {
      node.connect(out.input);
      return out.hold();
    }
    node.connect(out || B.sfx);
    return null;
  }

  // 0.0001 → peak (attack a) → 70% of peak (hold h) → 0.0001 (decay d).
  function envelope(param, t, a, peak, h, d) {
    const pk = Math.max(peak, 2 * MIN);
    param.setValueAtTime(MIN, t);
    param.exponentialRampToValueAtTime(pk, t + a);
    if (h > 0) param.exponentialRampToValueAtTime(Math.max(pk * 0.7, 2 * MIN), t + a + h);
    param.exponentialRampToValueAtTime(MIN, t + a + h + d);
    return t + a + h + d;
  }

  function tone(t, { type = 'sine', wave, f0, f1 = f0, sweep, a = 0.004, h = 0, d = 0.1, peak = 0.3, out }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    if (wave) o.setPeriodicWave(wave);
    else o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + (sweep ?? a + h + d));
    const end = envelope(g.gain, t, a, peak, h, d);
    o.connect(g);
    free([o], [g], attach(g, out));
    o.start(t);
    o.stop(end + 0.02);
    return o;
  }

  function noise(t, { kind = 'white', type = 'bandpass', f0 = 1000, f1 = f0, sweep, q = 1, a = 0.002, h = 0, d = 0.1, peak = 0.5, out }) {
    const s = ctx.createBufferSource();
    const f = filterNode(type, f0, q);
    const g = ctx.createGain();
    s.buffer = noiseBufs[kind];
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + (sweep ?? a + h + d));
    const end = envelope(g.gain, t, a, peak, h, d);
    s.connect(f);
    f.connect(g);
    free([s], [f, g], attach(g, out));
    const len = end - t + 0.03;
    s.start(t, rnd() * Math.max(0, s.buffer.duration - len - 0.1), len);
    return f;
  }

  function play(buf, t, gain, { rate = 1, out } = {}) {
    const s = ctx.createBufferSource();
    const g = gainNode(gain);
    s.buffer = buf;
    s.playbackRate.value = rate;
    s.connect(g);
    free([s], [g], attach(g, out));
    s.start(t);
    return s;
  }

  function cached(key, make) {
    let b = buffers.get(key);
    if (!b) buffers.set(key, (b = make()));
    return b;
  }

  const pluck = (m) => cached(`uke${m}`, () => renderPluck(ctx, mtof(m), mulberry32(m * 7919)));
  const mallet = (m, kind) =>
    cached(`${kind}${m}`, () =>
      kind === 'glock'
        ? renderModes(ctx, mtof(m), GLOCK, 1.5, 0.05, rnd)
        : renderModes(ctx, mtof(m), MARIMBA, 1.1, 0.12, rnd));
  const bellBuf = () => cached('bell', () => renderModes(ctx, 2100, BELL, 1.45, 0.25, rnd));
  const tickBuf = () => cached('tick', () => renderModes(ctx, 1, TICK, 0.022, 0.5, rnd));

  function build() {
    const r = mulberry32(12345);
    noiseBufs = makeNoise(ctx, 3, r);

    B.master = gainNode(muted ? 0 : volume);
    const comp = ctx.createDynamicsCompressor();
    const gentle = { threshold: -16, knee: 12, ratio: 3, attack: 0.006, release: 0.25 };
    for (const [k, v] of Object.entries(gentle)) comp[k].value = v;
    B.master.connect(comp);
    comp.connect(ctx.destination);

    B.sfx = gainNode(0.9, B.master);
    B.amb = gainNode(MIN, B.master);
    B.reverb = gainNode(0.5);
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 1.8, 1.4, r);
    B.reverb.connect(conv);
    conv.connect(B.master);

    // Music: voices → lowpass (darker at night) → fade gain → master, plus a reverb send.
    B.musicGain = gainNode(0, B.master);
    B.musicFilter = filterNode('lowpass', 7500, 0.5, B.musicGain);
    B.musicGain.connect(gainNode(0.3, B.reverb));
    // Warm bass: fundamental plus a little 2nd/3rd harmonic so it survives laptop speakers.
    B.bassWave = ctx.createPeriodicWave
      ? ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.3, 0.1]))
      : null;
    B.freewheel = gainNode(0.16, B.sfx);

    buildAmbience();
    UKE_PITCHES.forEach(pluck);
    // Everything else renders over the next few frames (or on first use) instead of in the click handler.
    const warm = [bellBuf, tickBuf, ...[...PENTATONIC, 76].map((m) => () => mallet(m, 'marimba')),
      ...[84, 88, 91, 96].map((m) => () => mallet(m, 'glock'))];
    warm.forEach((fn, i) => setTimeout(fn, 100 + i * 25));
  }

  function buildAmbience() {
    const loop = (buf) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      return s;
    };
    A.white = loop(noiseBufs.white);
    A.pink = loop(noiseBufs.pink);
    A.brown = loop(noiseBufs.brown);

    // Ocean: stereo pink + brown → swelling lowpass → swell gain → shoreline level.
    A.seaGain = gainNode(0.25, B.amb);
    A.swell = gainNode(0.4, A.seaGain);
    A.oceanLP = filterNode('lowpass', 700, 0.5, A.swell);
    A.pink.connect(A.oceanLP);
    A.brown.connect(A.oceanLP);

    // Wind: bandpassed white noise, centre and level follow speed.
    A.windGain = gainNode(0.003, B.amb);
    A.windBP = filterNode('bandpass', 260, 0.9, A.windGain);
    A.white.connect(A.windBP);

    // Tyres: lowpassed brown rumble plus a little bandpassed hiss.
    A.roadGain = gainNode(0, B.amb);
    A.roadLP = filterNode('lowpass', 90, 0.8, A.roadGain);
    A.brown.connect(A.roadLP);
    A.hissGain = gainNode(0, B.amb);
    A.hissBP = filterNode('bandpass', 1800, 0.6, A.hissGain);
    A.white.connect(A.hissBP);

    // Crickets: short chirp voices are scheduled into two fixed stereo spots.
    A.crickets = gainNode(0, B.amb);
    A.cricketPans = [-0.55, 0.6].map((p) => panNode(p, A.crickets));
  }

  function startAmbience() {
    const t = now();
    A.white.start(t, 0);
    A.pink.start(t, 1.1);
    A.brown.start(t, 2.3);
    B.amb.gain.setValueAtTime(MIN, t);
    B.amb.gain.exponentialRampToValueAtTime(1, t + 2.5);
    amb.gull = t + 3 + rnd() * 5;
  }

  // ---- Generative music ---------------------------------------------------

  function musicLevel(tc) {
    const soft = 1 - 0.4 * smoothstep(0.3, 0.7, night);
    glide(B.musicGain.gain, musicOn ? MUSIC_LEVEL * soft : 0, tc);
  }

  function startMusic() {
    clearTimeout(music.stopTimer);
    music.stopTimer = 0;
    musicLevel(0.6);
    if (music.timer) return;
    music.step = Math.ceil(music.step / 16) * 16;
    music.next = now() + 0.08;
    music.timer = setInterval(pump, 25);
    pump();
  }

  function stopMusic() {
    musicLevel(0.4);
    clearTimeout(music.stopTimer);
    music.stopTimer = setTimeout(() => {
      clearInterval(music.timer);
      music.timer = 0;
      music.stopTimer = 0;
    }, 2500);
  }

  function pump() {
    if (!ctx || ctx.state !== 'running') return;
    try {
      const t = ctx.currentTime;
      if (music.next < t - 0.1) {
        // Timers were throttled: skip ahead rather than bursting late notes.
        const skip = Math.ceil((t - music.next) / STEP);
        music.step += skip;
        music.next += skip * STEP;
      }
      while (music.next < t + LOOKAHEAD) {
        playStep(music.step, music.next);
        music.step++;
        music.next += STEP;
      }
    } catch (err) {
      clearInterval(music.timer);
      music.timer = 0;
      console.warn('[audio] music scheduler stopped:', err);
    }
  }

  function playStep(step, t) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const section = Math.floor(bar / 8) % 2;
    const chord = CHORDS[PROGRESSIONS[section][bar % 4]];
    const dark = night > 0.5;
    const ts = s % 4 === 2 ? t + SWING : t; // swung off-beat eighths
    const pattern = dark ? STRUMS.night : section ? STRUMS.b : STRUMS.a;
    for (const [at, dir, vel] of pattern) {
      if (at === s) strum(chord, dir, vel * (0.9 + mrnd() * 0.2), ts);
    }
    if (s === 0) bass(chord.bass, t, 1);
    else if (s === 8 && !(dark && bar % 2)) bass(chord.bass + (chord.bass + 7 <= 47 ? 7 : -5), t, 0.75);
    if (s % 4 === 2 && (!dark || mrnd() < 0.5)) shaker(ts, dark ? 0.5 : 1);
    else if (s % 4 === 0 && !dark) shaker(t, 0.3);
    if (s % 2 === 0 && bar >= 2 && !(bar % 4 === 3 && s >= 8)) {
      const p = (s % 4 === 0 ? 0.24 : 0.12) * (dark ? 0.3 : 1);
      if (mrnd() < p) melody(chord, s, ts);
    }
  }

  function strum(chord, dir, vel, t) {
    const prev = music.lastStrum;
    if (prev) {
      // Re-striking the strings damps whatever is still ringing.
      prev.gain.gain.setTargetAtTime(0, t, 0.02);
      for (const s of prev.sources) {
        try { s.stop(t + 0.15); } catch (_) { /* already stopped */ }
      }
    }
    const notes = dir === 'D' ? chord.notes : chord.notes.slice(1).reverse();
    const spread = dir === 'D' ? 0.012 + mrnd() * 0.013 : 0.012 + mrnd() * 0.006;
    const g = gainNode(vel * STRUM_GAIN, B.musicFilter);
    const sources = notes.map((m, i) => {
      const s = ctx.createBufferSource();
      s.buffer = pluck(m);
      s.playbackRate.value = 1 + (mrnd() - 0.5) * 0.003;
      s.connect(g);
      s.start(t + i * spread);
      return s;
    });
    free(sources, [g]);
    music.lastStrum = { gain: g, sources };
  }

  function bass(m, t, vel) {
    tone(t, { type: 'triangle', wave: B.bassWave, f0: mtof(m), a: 0.012, h: 0.08, d: 0.42, peak: BASS_GAIN * vel, out: B.musicFilter });
  }

  function shaker(t, vel) {
    noise(t, { type: 'highpass', f0: 6000, q: 0.7, a: 0.008, d: 0.06, peak: SHAKER_GAIN * vel, out: B.musicFilter });
  }

  function melody(chord, s, t) {
    let i = clamp(music.mel + WALK[Math.floor(mrnd() * WALK.length)], 0, PENTATONIC.length - 1);
    if (i > 7 && mrnd() < 0.5) i -= 2; // drift back toward the middle register
    else if (i < 2 && mrnd() < 0.5) i += 2;
    if (s === 0) {
      const j = [i, i + 1, i - 1, i + 2, i - 2].find(
        (k) => k >= 0 && k < PENTATONIC.length && chord.pcs.includes(PENTATONIC[k] % 12));
      if (j !== undefined) i = j;
    }
    music.mel = i;
    play(mallet(PENTATONIC[i], 'marimba'), t, MELODY_GAIN * (0.7 + mrnd() * 0.3), { out: B.musicFilter });
  }

  // ---- Per-frame ambience -------------------------------------------------

  function update(state = {}) {
    night = clamp(num(state.night), 0, 1);
    if (!started || ctx.state !== 'running') return;
    try {
      const t = ctx.currentTime;
      const speed = clamp(num(state.speed), 0, 30);
      const air = !!state.airborne;
      const gust = 0.6 * Math.sin(t * 1.17) + 0.4 * Math.sin(t * 2.3 + 1.7);

      glide(A.windBP.frequency, 260 + 115 * speed, 0.15);
      glide(A.windGain.gain, (0.003 + 0.006 * speed * speed) * (1 + 0.15 * gust), 0.12);

      const roll = air ? 0 : Math.min(speed, 14);
      glide(A.roadGain.gain, roll * 0.06, air ? 0.02 : 0.08);
      glide(A.roadLP.frequency, 80 + 24 * speed, 0.15);
      glide(A.hissGain.gain, roll * 0.018, air ? 0.02 : 0.08);

      if (t - amb.slowAt >= 0.05) {
        amb.slowAt = t;
        slowUpdate(t, gust, clamp(num(state.nearSea, 0.5), 0, 1));
      }
      freewheel(t, speed, state);
      if (night > 0.03) crickets(t);
      if (t >= amb.gull) {
        if (rnd() < 1 - night) gullCall((rnd() * 2 - 1) * 0.85, 0.15 + rnd() * 0.25, B.amb, 0.45);
        amb.gull = t + 6 + rnd() * 9;
      }
    } catch (err) {
      if (!warnedUpdate) console.warn('[audio] update failed:', err);
      warnedUpdate = true;
    }
  }

  function slowUpdate(t, gust, nearSea) {
    // Ocean swell: three incommensurate LFOs (7.3 s, 11.9 s, 9.1 s) shaped into crests.
    const w = 0.5 + 0.27 * Math.sin((TAU * t) / 7.3) + 0.16 * Math.sin((TAU * t) / 11.9 + 1.3)
      + 0.1 * Math.sin((TAU * t) / 9.1 + 4.2);
    const swell = Math.max(0.03, w) ** 1.6;
    glide(A.swell.gain, 0.12 + 0.95 * swell, 0.3);
    glide(A.oceanLP.frequency, 300 + 1500 * swell, 0.35);
    glide(A.seaGain.gain, 0.04 + 0.5 * nearSea, 0.5);
    glide(A.windBP.detune, gust * 250, 0.25);
    glide(A.crickets.gain, night ** 1.5, 1);
    glide(B.musicFilter.frequency, 7500 * (1400 / 7500) ** smoothstep(0.3, 0.7, night), 1);
    musicLevel(1);
  }

  function freewheel(t, speed, state) {
    if (state.pedaling || speed <= 0.5) {
      amb.tick = 0;
      return;
    }
    const omega = Math.abs(num(state.wheelOmega, speed / 0.34));
    const rate = Math.min(45, (omega / TAU) * 18);
    if (rate < 1) return;
    if (amb.tick < t) amb.tick = t + 0.01;
    const buf = tickBuf();
    while (amb.tick < t + 0.05) {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = 0.9 + rnd() * 0.2;
      s.connect(B.freewheel);
      s.onended = () => disconnect(s);
      s.start(amb.tick);
      amb.tick += (0.94 + rnd() * 0.12) / rate;
    }
  }

  function crickets(t) {
    CRICKETS.forEach((c, i) => {
      let next = amb.crickets[i];
      if (next < t) next = t + 0.02 + rnd() * 0.4;
      while (next < t + 0.2) {
        chirp(next, c, A.cricketPans[i]);
        next += c.gap + rnd() * 0.25 + (rnd() < 0.07 ? 0.8 + rnd() * 1.6 : 0);
      }
      amb.crickets[i] = next;
    });
  }

  // One chirp = a few fast amplitude pulses of a ~4.5 kHz sine.
  function chirp(t, c, dest) {
    const o = ctx.createOscillator();
    const g = gainNode(0, dest);
    o.frequency.value = c.freq * (0.996 + rnd() * 0.008);
    g.gain.setValueAtTime(0, t);
    for (let k = 0; k < c.pulses; k++) {
      const tk = t + k * c.period;
      g.gain.setValueAtTime(0, tk);
      g.gain.linearRampToValueAtTime(c.amp, tk + 0.004);
      g.gain.linearRampToValueAtTime(0, tk + c.period * 0.8);
    }
    o.connect(g);
    free([o], [g]);
    o.start(t);
    o.stop(t + c.pulses * c.period + 0.02);
  }

  // "Kyow-kyow": sawtooth with a rise-then-fall contour per syllable, slight
  // FM roughness, through a formant bandpass.
  function gullCall(pan, vol, dest, send) {
    const t0 = now() + 0.02;
    const v = voice(dest, { pan, send, gain: vol });
    const o = ctx.createOscillator();
    const rough = ctx.createOscillator();
    const depth = gainNode(55);
    const hp = filterNode('highpass', 700, 0.7);
    const bp = filterNode('bandpass', 2300, 2.2);
    const g = gainNode(0);
    o.type = 'sawtooth';
    rough.frequency.value = 55 + rnd() * 30;
    rough.connect(depth);
    depth.connect(o.frequency);
    o.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    const k = 0.85 + rnd() * 0.3;
    const syllables = 2 + Math.floor(rnd() * 3);
    let ts = t0;
    g.gain.setValueAtTime(MIN, t0);
    for (let i = 0; i < syllables; i++) {
      const dur = (0.24 + rnd() * 0.08) * (1 - 0.08 * i);
      const kk = k * (1 - 0.035 * i);
      o.frequency.setValueAtTime(1300 * kk, ts);
      o.frequency.exponentialRampToValueAtTime(2000 * kk, ts + dur * 0.3);
      o.frequency.exponentialRampToValueAtTime(900 * kk, ts + dur);
      bp.frequency.setValueAtTime(2300 * kk, ts);
      bp.frequency.exponentialRampToValueAtTime(1700 * kk, ts + dur);
      g.gain.setValueAtTime(MIN, ts);
      g.gain.exponentialRampToValueAtTime(0.9, ts + 0.03);
      g.gain.exponentialRampToValueAtTime(0.5, ts + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(MIN, ts + dur);
      ts += dur + 0.07 + rnd() * 0.07;
    }
    free([o, rough], [depth, hp, bp, g], attach(g, v));
    o.start(t0);
    rough.start(t0);
    o.stop(ts);
    rough.stop(ts);
  }

  // ---- One-shot SFX -------------------------------------------------------

  function bell() {
    if (!ready()) return;
    const t = now() + 0.005;
    const rate = 0.985 + rnd() * 0.03;
    const v = voice(B.sfx, { send: 0.35 });
    play(bellBuf(), t, 0.55, { rate, out: v });
    play(bellBuf(), t + 0.14, 0.45, { rate, out: v });
  }

  function billClap(count = 3) {
    if (!ready()) return;
    const n = clamp(Math.round(num(count, 3)), 1, 12);
    const t0 = now() + 0.005;
    const v = voice(B.sfx, { pan: (rnd() - 0.5) * 0.3, send: 0.06 });
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.09 + rnd() * 0.01;
      const vel = 1 - (0.35 * i) / n;
      noise(t, { f0: (i % 2 ? 1300 : 2200) * (0.9 + rnd() * 0.2), q: 4.5, a: 0.001, d: 0.035, peak: 2.4 * vel, out: v });
      tone(t, { f0: 190, f1: 95, a: 0.001, d: 0.03, peak: 0.35 * vel, out: v });
    }
  }

  function gulp() {
    if (!ready()) return;
    const t = now() + 0.005;
    const v = voice(B.sfx);
    tone(t, { f0: 420, f1: 90, sweep: 0.25, a: 0.015, h: 0.12, d: 0.14, peak: 0.5, out: v });
    noise(t + 0.03, { kind: 'brown', type: 'lowpass', f0: 800, f1: 180, q: 4, a: 0.03, h: 0.06, d: 0.14, peak: 0.9, out: v });
    tone(t + 0.32, { f0: 320, f1: 200, a: 0.004, d: 0.06, peak: 0.22, out: v });
  }

  function splash(volume = 1, pan = 0) {
    if (!ready()) return;
    const vol = clamp(num(volume, 1), 0, 2);
    if (vol < 0.01) return;
    const t = now() + 0.005;
    const v = voice(B.sfx, { gain: vol, pan: clamp(num(pan), -1, 1), send: 0.15 });
    noise(t, { type: 'lowpass', f0: 6000, f1: 400, sweep: 0.6, q: 0.8, a: 0.008, h: 0.06, d: 0.55, peak: 0.8, out: v });
    noise(t, { kind: 'brown', type: 'lowpass', f0: 1200, f1: 250, q: 1, a: 0.01, h: 0.03, d: 0.3, peak: 0.7, out: v });
    for (let i = 3 + Math.floor(rnd() * 4); i > 0; i--) {
      const f = 1100 + rnd() * 1900;
      tone(t + 0.08 + rnd() * 0.5, { f0: f, f1: f * 1.7, sweep: 0.05, a: 0.002, d: 0.05 + rnd() * 0.04, peak: 0.08 + rnd() * 0.1, out: v });
    }
  }

  function whoosh() {
    if (!ready()) return;
    const t = now() + 0.005;
    const v = voice(B.sfx, { pan: -0.25 });
    if (v.panner) {
      v.panner.pan.setValueAtTime(-0.25, t);
      v.panner.pan.linearRampToValueAtTime(0.25, t + 0.35);
    }
    noise(t, { f0: 350, f1: 3200, sweep: 0.35, q: 1.3, a: 0.14, h: 0.04, d: 0.18, peak: 1.3, out: v });
    noise(t, { kind: 'pink', type: 'lowpass', f0: 400, f1: 1400, sweep: 0.3, q: 0.6, a: 0.1, h: 0.03, d: 0.2, peak: 0.5, out: v });
  }

  function thump() {
    if (!ready()) return;
    const t = now() + 0.005;
    const v = voice(B.sfx);
    tone(t, { f0: 90, f1: 45, sweep: 0.2, a: 0.003, h: 0.05, d: 0.16, peak: 0.9, out: v });
    noise(t, { type: 'lowpass', f0: 2500, q: 0.7, a: 0.001, h: 0.004, d: 0.03, peak: 0.8, out: v });
    noise(t, { kind: 'brown', f0: 220, q: 1.2, a: 0.002, h: 0.01, d: 0.08, peak: 1.2, out: v });
    // Spring/fender rattle: a few quick, decaying metallic ticks.
    let tt = t + 0.035;
    for (let i = 0; i < 6; i++) {
      play(tickBuf(), tt, 0.5 * (1 - i / 7), { rate: 0.5 + rnd() * 0.3, out: v });
      tt += 0.026 + i * 0.006 + rnd() * 0.006;
    }
  }

  function seagull(pan = 0) {
    if (!ready()) return;
    gullCall(clamp(num(pan), -1, 1), 0.6, B.sfx, 0.3);
  }

  function chime() {
    if (!ready()) return;
    const t = now() + 0.005;
    const v = voice(B.sfx, { send: 0.3 });
    [84, 88, 91, 96].forEach((m, i) => {
      const last = i === 3;
      play(mallet(m, 'glock'), t + i * 0.085, last ? 0.4 : 0.3, { out: v });
      play(mallet(m - 12, 'marimba'), t + i * 0.085, last ? 0.22 : 0.16, { out: v });
    });
  }

  function shutter() {
    if (!ready()) return;
    const t = now() + 0.005;
    const v = voice(B.sfx);
    noise(t, { f0: 4200, q: 2, a: 0.0008, h: 0.002, d: 0.022, peak: 1.8, out: v });
    tone(t, { type: 'triangle', f0: 2400, f1: 1800, a: 0.0005, d: 0.015, peak: 0.1, out: v });
    noise(t + 0.08, { f0: 2400, q: 1.6, a: 0.0008, h: 0.003, d: 0.04, peak: 1.5, out: v });
    tone(t + 0.08, { f0: 170, f1: 90, a: 0.001, h: 0.004, d: 0.04, peak: 0.3, out: v });
  }

  function pop() {
    if (!ready()) return;
    tone(now() + 0.003, { f0: 900, f1: 380, sweep: 0.05, a: 0.002, h: 0.004, d: 0.07, peak: 0.22, out: B.sfx });
  }

  function whistle() {
    if (!ready()) return;
    const t = now() + 0.005;
    const v = voice(B.sfx, { send: 0.12 });
    const o = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const depth = gainNode(0);
    const g = gainNode(0);
    lfo.frequency.value = 24;
    depth.gain.setValueAtTime(10, t);
    depth.gain.linearRampToValueAtTime(90, t + 0.34);
    lfo.connect(depth);
    depth.connect(o.frequency);
    o.frequency.setValueAtTime(1100, t);
    o.frequency.exponentialRampToValueAtTime(1900, t + 0.11);
    o.frequency.setValueAtTime(1400, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(2800, t + 0.34);
    envelope(g.gain, t, 0.02, 0.28, 0.09, 0.025);
    envelope(g.gain, t + 0.15, 0.02, 0.3, 0.13, 0.05);
    o.connect(g);
    free([o, lfo], [depth, g], attach(g, v));
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.4);
    lfo.stop(t + 0.4);
  }

  // ---- Lifecycle ----------------------------------------------------------

  async function start() {
    try {
      if (!ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) {
          console.warn('[audio] Web Audio API is not available');
          return;
        }
        try {
          ctx = new AC({ latencyHint: 'interactive' });
        } catch (_) {
          ctx = new AC();
        }
        build();
        startAmbience();
        started = true;
      }
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        // resume() can stay pending forever without a gesture; don't hang the caller.
        await Promise.race([ctx.resume(), wait(500)]);
      }
      if (started && musicOn) startMusic();
    } catch (err) {
      console.warn('[audio] start failed:', err);
    }
  }

  async function suspend() {
    try {
      if (ctx && ctx.state === 'running') await ctx.suspend();
    } catch (err) {
      console.warn('[audio] suspend failed:', err);
    }
  }

  async function resume() {
    try {
      if (ctx && (ctx.state === 'suspended' || ctx.state === 'interrupted')) {
        await Promise.race([ctx.resume(), wait(500)]);
      }
    } catch (err) {
      console.warn('[audio] resume failed:', err);
    }
  }

  function setMuted(value) {
    muted = !!value;
    if (started) glide(B.master.gain, muted ? 0 : volume, 0.05);
  }

  function setMasterVolume(value) {
    volume = clamp(num(value, volume), 0, 1);
    if (started) glide(B.master.gain, muted ? 0 : volume, 0.05);
  }

  function setMusicEnabled(value) {
    musicOn = !!value;
    if (!ready()) return;
    if (musicOn) startMusic();
    else stopMusic();
  }

  return {
    start,
    get started() { return started; },
    setMuted,
    get muted() { return muted; },
    setMusicEnabled,
    get musicEnabled() { return musicOn; },
    setMasterVolume,
    update,
    bell, billClap, gulp, splash, whoosh, thump, seagull, chime, shutter, pop, whistle,
    suspend,
    resume,
  };
}
