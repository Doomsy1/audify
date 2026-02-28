/**
 * compare_v1 — two-series comparison preset.
 *
 * Structure:
 *  - Series A plays in the first half of the clip.
 *  - A 60 ms silent gap separates the two phrases.
 *  - Series B plays in the second half.
 *  - Both series share the same pitch range so values are directly comparable.
 *  - 30 ms fade-in/out applied to each half independently.
 */

import { normToFreq, normalizeValues, triangleSample } from "../sharedMapping.js";

const FADE_MS = 30;
const GAP_MS  = 60;

/**
 * @param {object} opts
 * @param {import('../../contracts/sonify.js').CompareSeries} opts.a
 * @param {import('../../contracts/sonify.js').CompareSeries} opts.b
 * @param {number} [opts.durationMs=3200]  Total clip length (both halves + gap)
 * @param {number} [opts.sampleRate=24000]
 * @returns {{ samples: Float32Array, explainHint: string }}
 */
export function renderCompareV1({
  a,
  b,
  durationMs  = 3200,
  sampleRate  = 24000,
} = {}) {
  const gapSamples  = Math.floor(sampleRate * GAP_MS / 1000);
  const halfSamples = Math.floor((sampleRate * durationMs / 1000 - gapSamples) / 2);
  const totalSamples = halfSamples * 2 + gapSamples;
  const samples      = new Float32Array(totalSamples);

  // Normalise both series together so pitch comparisons are meaningful
  const allValues  = [...a.points.map((p) => p.v), ...b.points.map((p) => p.v)];
  const allNorm    = normalizeValues(allValues, "minmax");
  const normA      = allNorm.slice(0, a.points.length);
  const normB      = allNorm.slice(a.points.length);

  renderHalf(samples, 0,                        a.points, normA, halfSamples, sampleRate);
  renderHalf(samples, halfSamples + gapSamples, b.points, normB, halfSamples, sampleRate);

  return {
    samples,
    explainHint:
      `First phrase is ${a.label}, second phrase is ${b.label}. ` +
      "Higher notes mean larger values.",
  };
}

/**
 * Render one half of the compare clip into a slice of `samples`.
 *
 * @param {Float32Array} samples  Output buffer (written in place)
 * @param {number}       offset   Write start index
 * @param {Array}        points
 * @param {number[]}     normalized
 * @param {number}       halfSamples
 * @param {number}       sampleRate
 */
function renderHalf(samples, offset, points, normalized, halfSamples, sampleRate) {
  const fadeSamples     = Math.floor(sampleRate * FADE_MS / 1000);
  const samplesPerPoint = halfSamples / Math.max(1, points.length);
  let   phase           = 0;

  for (let i = 0; i < points.length; i++) {
    const norm  = normalized[i];
    const freq  = normToFreq(norm);
    const amp   = 0.25 + 0.55 * norm;
    const start = offset + Math.floor(i * samplesPerPoint);
    const end   = Math.min(offset + Math.floor((i + 1) * samplesPerPoint), offset + halfSamples);

    for (let s = start; s < end; s++) {
      const phaseNorm = (phase / (2 * Math.PI)) % 1;
      samples[s]      = amp * triangleSample(phaseNorm);
      phase          += (2 * Math.PI * freq) / sampleRate;
    }
  }

  // Fade in
  for (let i = 0; i < Math.min(fadeSamples, halfSamples); i++) {
    samples[offset + i] *= i / fadeSamples;
  }
  // Fade out
  for (let i = 0; i < Math.min(fadeSamples, halfSamples); i++) {
    samples[offset + halfSamples - 1 - i] *= i / fadeSamples;
  }
}
