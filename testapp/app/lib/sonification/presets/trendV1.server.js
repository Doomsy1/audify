/**
 * trend_v1 — single time-series sonification preset.
 *
 * Mapping:
 *  - Each data point occupies an equal slice of the total duration.
 *  - Pitch   = normToFreq(normalised value)  — higher value → higher pitch.
 *  - Volume  = 0.25 + 0.55 × norm            — louder on large values.
 *  - Timbre  = triangle wave (matches audioEngine.js oscillator type).
 *  - Glide   = phase accumulation across adjacent points → smooth frequency transitions.
 *  - Events  = z > 2.0 → spike marker tick (880 Hz exponential decay burst).
 *  - Fades   = 20 ms fade-in + fade-out to prevent clicks at start/end.
 */

import { normToFreq, normalizeValues, triangleSample } from "../sharedMapping.js";

const FADE_MS    = 20;
const TICK_MS    = 40;   // event marker duration
const TICK_FREQ  = 880;  // Hz
const TICK_GAIN  = 0.15;
const TICK_DECAY = 40;   // exponential decay constant (larger = faster)
const Z_SPIKE    = 2.0;  // z-score threshold for event markers

/**
 * Render a trend_v1 clip.
 *
 * @param {object} opts
 * @param {import('../../contracts/sonify.js').SeriesPoint[]} opts.points
 * @param {number} [opts.durationMs=2800]
 * @param {number} [opts.sampleRate=24000]
 * @param {'minmax'|'zscore'} [opts.normalize='minmax']
 * @param {number} [opts.speed=1]  Duration multiplier (speed=2 → half duration)
 * @returns {{ samples: Float32Array, events: import('../../contracts/sonify.js').SonifyEvent[] }}
 */
export function renderTrendV1({
  points,
  durationMs  = 2800,
  sampleRate  = 24000,
  normalize   = "minmax",
  speed       = 1,
} = {}) {
  if (!points?.length) {
    return { samples: new Float32Array(0), events: [] };
  }

  const effectiveDurationMs = durationMs / Math.max(0.1, speed);
  const totalSamples        = Math.max(1, Math.floor(sampleRate * effectiveDurationMs / 1000));
  const samples             = new Float32Array(totalSamples);
  const fadeSamples         = Math.floor(sampleRate * FADE_MS / 1000);
  const tickSamples         = Math.floor(sampleRate * TICK_MS / 1000);

  const values     = points.map((p) => p.v);
  const normalized = normalizeValues(values, normalize);

  // Z-scores for spike/dip detection
  const mean  = values.reduce((s, v) => s + v, 0) / values.length;
  const sigma = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) || 1;

  const events    = [];
  const samplesPerPoint = totalSamples / points.length;
  let   phase     = 0; // accumulated phase [0, 2π) — glides smoothly between frequencies

  for (let i = 0; i < points.length; i++) {
    const norm  = normalized[i];
    const freq  = normToFreq(norm);
    const amp   = 0.25 + 0.55 * norm;
    const start = Math.floor(i * samplesPerPoint);
    const end   = Math.min(Math.floor((i + 1) * samplesPerPoint), totalSamples);

    // Detect spike / dip
    const z = (values[i] - mean) / sigma;
    if (Math.abs(z) >= Z_SPIKE) {
      events.push({
        t:        points[i].t,
        type:     z > 0 ? "spike" : "dip",
        strength: Math.min(1, Math.abs(z) / 4),
      });
    }

    // Main tone — triangle wave, phase accumulation
    for (let s = start; s < end; s++) {
      const phaseNorm = (phase / (2 * Math.PI)) % 1;
      samples[s]      = amp * triangleSample(phaseNorm);
      phase          += (2 * Math.PI * freq) / sampleRate;
    }

    // Event tick — brief high-frequency burst added on top
    if (Math.abs(z) >= Z_SPIKE) {
      const tickEnd = Math.min(start + tickSamples, totalSamples);
      for (let s = start; s < tickEnd; s++) {
        const t    = (s - start) / sampleRate;
        const env  = Math.exp(-t * TICK_DECAY);
        const tick = env * Math.sin(2 * Math.PI * TICK_FREQ * t) * TICK_GAIN;
        samples[s] += tick;
      }
    }
  }

  // Fade in / out
  for (let i = 0; i < Math.min(fadeSamples, totalSamples); i++) {
    const gain = i / fadeSamples;
    samples[i]                       *= gain;
    samples[totalSamples - 1 - i]   *= gain;
  }

  return { samples, events };
}
