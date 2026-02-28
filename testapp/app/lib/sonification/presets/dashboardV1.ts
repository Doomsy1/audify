/**
 * dashboardV1 — stereo sonification preset.
 *
 * Pure TypeScript — no Node.js APIs. Runs in the browser or on the server.
 *
 * Matches sonify_dashboard.py audio behaviour:
 *   - 44100 Hz sample rate  (Python auto-detects, typically 48000; 44100 is browser-safe)
 *   - 18 s duration         (AUDIO_DURATION = 18.0 in the Python script)
 *   - Catmull-Rom cubic interpolation  (scipy interp1d kind='cubic')
 *   - 2nd-order Butterworth LP filter  (scipy butter(2, …))
 *
 * LEFT  = traffic (orders): warm organ pad, pitch rises with order volume.
 * RIGHT = revenue echo: bright chorus (3 detuned layers), more reverb,
 *         delayed by the auto-detected traffic→revenue lag in days.
 *
 * Echo louder = higher conversion rate.
 * Day ticks (optional woodblock clicks) let you count the lag.
 */

const TWO_PI = 2 * Math.PI;

export interface TimePoint {
  t: string;
  v: number;
}

export interface RenderDashboardV1Options {
  trafficPoints: TimePoint[];
  revenuePoints: TimePoint[];
  /** Total clip length in ms. Default 18000 (matches Python AUDIO_DURATION=18). */
  durationMs?: number;
  /** Default 44100 (browser-safe; Python auto-detects ~48000). */
  sampleRate?: number;
  /** null = auto-detect via cross-correlation. */
  lagDays?: number | null;
  /** Woodblock click every day boundary. Default true. */
  ticks?: boolean;
}

export interface RenderDashboardV1Result {
  wav: Uint8Array;
  lagDays: number;
}

// ── 2nd-order Butterworth low-pass filter (biquad) ─────────────────────────────
// Matches scipy.signal.butter(2, cutoff, btype='low').
// Q = 1/√2 ≈ 0.7071 gives maximally flat (Butterworth) response.
function lpFilter(
  samples: Float32Array,
  cutoffHz: number,
  sampleRate: number,
): Float32Array {
  const w0 = TWO_PI * Math.min(cutoffHz, sampleRate * 0.499) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * 0.7071); // Q = 1/sqrt(2)

  const b0 = (1 - cosW0) / 2;
  const b1 = 1 - cosW0;
  const b2 = (1 - cosW0) / 2;
  const a0 = 1 + alpha;
  const a1n = -2 * cosW0;  // a1 / a0 (negated for the recursion sign)
  const a2 = 1 - alpha;

  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1n * y1 - a2 * y2) / a0;
    out[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return out;
}

// ── Parallel comb-delay reverb ─────────────────────────────────────────────────
// taps: [delayMs, decay][] — reads from dry signal, adds to wet copy.
function addReverb(
  dry: Float32Array,
  sampleRate: number,
  taps: [number, number][],
): Float32Array {
  const wet = new Float32Array(dry);
  for (const [delayMs, decay] of taps) {
    const d = Math.round((sampleRate * delayMs) / 1000);
    if (d >= wet.length) continue;
    for (let i = d; i < wet.length; i++) {
      wet[i] += dry[i - d] * decay;
    }
  }
  return wet;
}

// ── Waveforms ──────────────────────────────────────────────────────────────────

// Warm organ: harmonic series, fades toward upper partials.
function organSample(p: number): number {
  return (
    Math.sin(p) +
    0.5 * Math.sin(2 * p) +
    0.25 * Math.sin(3 * p) +
    0.1 * Math.sin(4 * p)
  );
}

// Bright string/synth: rising upper harmonics, clearly distinct from organ.
function brightSample(p: number): number {
  return (
    Math.sin(p) +
    0.8 * Math.sin(2 * p) +
    0.6 * Math.sin(3 * p) +
    0.45 * Math.sin(4 * p) +
    0.3 * Math.sin(5 * p) +
    0.18 * Math.sin(6 * p)
  );
}

// ── Normalisation helpers ──────────────────────────────────────────────────────

function logNorm(values: number[]): number[] {
  const logged = values.map((v) => Math.log1p(Math.max(0, v)));
  let lo = logged[0];
  let hi = logged[0];
  for (const v of logged) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1e-9;
  return logged.map((v) => (v - lo) / range);
}

function minMaxNorm(values: number[]): number[] {
  let lo = values[0];
  let hi = values[0];
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1e-9;
  return values.map((v) => (v - lo) / range);
}

// 80–640 Hz, 3 octaves, exponential (same range as audioEngine.js / Python script).
function normToHz(norm: number): number {
  return 80 * Math.pow(2, 3 * Math.max(0, Math.min(1, norm)));
}

// ── Catmull-Rom cubic spline interpolation ─────────────────────────────────────
// Matches scipy interp1d(kind='cubic') — smooth pitch glides between day values.
function catmullRomAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function dayToSamples(dayVals: number[], totalSamples: number): Float32Array {
  const n = dayVals.length;
  const out = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const t = (i / (totalSamples - 1)) * (n - 1);
    const idx = Math.floor(t);
    const frac = t - idx;
    const p0 = dayVals[Math.max(0, idx - 1)];
    const p1 = dayVals[Math.min(n - 1, idx)];
    const p2 = dayVals[Math.min(n - 1, idx + 1)];
    const p3 = dayVals[Math.min(n - 1, idx + 2)];
    // Clamp to 0 — log-normalised values are always ≥ 0 so negative overshoot is wrong.
    out[i] = Math.max(0, catmullRomAt(p0, p1, p2, p3, frac));
  }
  return out;
}

// ── Cross-correlation lag detection (0–3 days) ─────────────────────────────────
function detectLag(traffic: number[], revenue: number[]): number {
  const n = traffic.length;
  const tN = logNorm(traffic);
  const rN = logNorm(revenue);
  const tMu = tN.reduce((s, v) => s + v, 0) / n;
  const rMu = rN.reduce((s, v) => s + v, 0) / n;
  const tC = tN.map((v) => v - tMu);
  const rC = rN.map((v) => v - rMu);

  let bestLag = 1;
  let bestCorr = -Infinity;
  for (let lag = 0; lag <= 3; lag++) {
    let corr = 0;
    const len = n - lag;
    for (let i = 0; i < len; i++) corr += tC[i] * rC[i + lag];
    corr /= len;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  return bestLag;
}

// ── Normalize to target peak amplitude ────────────────────────────────────────
function normalizePeak(samples: Float32Array, target = 0.8): void {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  if (peak > 0) {
    const gain = target / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  }
}

// ── Stereo WAV encoder (2-channel interleaved PCM) ────────────────────────────
function encodeStereoWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Uint8Array {
  const frames = left.length;
  const dataSize = frames * 4; // 2 ch × 2 bytes
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const w = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i));
  };

  w(0, "RIFF"); dv.setUint32(4, 36 + dataSize, true);
  w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 2, true);                               // numChannels
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 4, true);                  // byteRate
  dv.setUint16(32, 4, true);                               // blockAlign
  dv.setUint16(34, 16, true);                              // bitsPerSample
  w(36, "data"); dv.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < frames; i++) {
    dv.setInt16(off, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
    off += 2;
    dv.setInt16(off, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
    off += 2;
  }
  return new Uint8Array(buf);
}

// ── Woodblock day tick marks ───────────────────────────────────────────────────
function addDayTicks(
  left: Float32Array,
  right: Float32Array,
  numDays: number,
  sampleRate: number,
): void {
  const clickLen = Math.round(0.018 * sampleRate);
  const spd = left.length / numDays;
  for (let d = 0; d < numDays; d++) {
    const onset = Math.round(d * spd);
    for (let s = 0; s < clickLen; s++) {
      const t = s / sampleRate;
      const tick = Math.exp(-t * 300) * Math.sin(TWO_PI * 900 * t) * 0.13;
      const idx = onset + s;
      if (idx < left.length) {
        left[idx] += tick;
        right[idx] += tick;
      }
    }
  }
}

// ── Main render ────────────────────────────────────────────────────────────────

/**
 * Render a stereo dashboard clip.
 *
 * Parameters match sonify_dashboard.py (18 s, 44100 Hz, cubic interpolation,
 * 2nd-order Butterworth LP). Pure TypeScript — runs in Node.js or the browser.
 */
export function renderDashboardV1({
  trafficPoints,
  revenuePoints,
  durationMs = 18000,
  sampleRate = 44100,
  lagDays = null,
  ticks = true,
}: RenderDashboardV1Options): RenderDashboardV1Result {
  const numDays = trafficPoints.length;
  const totalSamples = Math.round((durationMs / 1000) * sampleRate);

  const traffic = trafficPoints.map((p) => p.v);
  const revenue = revenuePoints.map((p) => p.v);

  // Conversion rate: revenue per order — drives echo pitch/amplitude.
  const rps = revenue.map((r, i) => r / (traffic[i] + 1e-9));

  const detectedLag = lagDays ?? detectLag(traffic, revenue);

  // Per-day normalised pitch/amplitude maps
  const sLogN = logNorm(traffic);
  const sN = minMaxNorm(traffic);
  const rLogN = logNorm(rps);
  const rN = minMaxNorm(rps);

  // Interpolated per-sample frequency and amplitude (cubic spline)
  const freqL = dayToSamples(sLogN.map(normToHz), totalSamples);
  const ampL = dayToSamples(sN.map((n) => 0.25 + 0.55 * n), totalSamples);
  const freqR = dayToSamples(rLogN.map(normToHz), totalSamples);
  const ampR = dayToSamples(rN.map((n) => 0.25 + 0.55 * n), totalSamples);

  // ── LEFT: organ pad + gentle vibrato ──────────────────────────────────────
  const rawL = new Float32Array(totalSamples);
  let phL = 0;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const vib = 1 + 0.004 * Math.sin(TWO_PI * 5.2 * t);
    rawL[i] = organSample(phL) * ampL[i];
    phL += (TWO_PI * freqL[i] * vib) / sampleRate;
  }
  const filtL = lpFilter(rawL, 1000, sampleRate);
  const sigL = addReverb(filtL, sampleRate, [
    [18, 0.2],
    [37, 0.12],
    [58, 0.07],
  ]);

  // ── RIGHT: bright chorus (3 detuned layers ±1.5%) + more reverb ───────────
  const rawR = new Float32Array(totalSamples);
  let ph0 = 0;
  let ph1 = 0;
  let ph2 = 0;
  for (let i = 0; i < totalSamples; i++) {
    const dt = (TWO_PI * freqR[i]) / sampleRate;
    rawR[i] =
      ((brightSample(ph0) + brightSample(ph1) + brightSample(ph2)) / 3) *
      ampR[i];
    ph0 += dt * 1.0;
    ph1 += dt * 1.015;
    ph2 += dt * 0.985;
  }
  const filtR = lpFilter(rawR, 2500, sampleRate);
  const reverbR = addReverb(filtR, sampleRate, [
    [28, 0.45],
    [55, 0.32],
    [90, 0.2],
    [135, 0.12],
  ]);

  // Apply lag — echo arrives lag_days later in the timeline.
  const lagSamples = Math.round(detectedLag * (totalSamples / numDays));
  const sigR = new Float32Array(totalSamples);
  for (let i = lagSamples; i < totalSamples; i++) {
    sigR[i] = reverbR[i - lagSamples];
  }

  // ── Stereo mix: normalise each channel to 0.80 peak ───────────────────────
  normalizePeak(sigL, 0.8);
  normalizePeak(sigR, 0.8);

  if (ticks) addDayTicks(sigL, sigR, numDays, sampleRate);

  // Hard clip
  for (let i = 0; i < totalSamples; i++) {
    sigL[i] = Math.max(-1, Math.min(1, sigL[i]));
    sigR[i] = Math.max(-1, Math.min(1, sigR[i]));
  }

  return { wav: encodeStereoWav(sigL, sigR, sampleRate), lagDays: detectedLag };
}
