/**
 * Shared sonification constants and pure mapping functions.
 *
 * Used by BOTH:
 *  - client-side  audioEngine.js  (browser Web Audio API playback)
 *  - server-side  trendV1/compareV1 presets (WAV rendering)
 *
 * Keep this file free of Node-only or browser-only globals.
 */

// ── Core audio constants ──────────────────────────────────────────────────────

export const BASE_FREQUENCY  = 220;   // Hz — concert A / 2
export const MASTER_GAIN     = 0.12;
export const OSC_GAIN        = 0.5;

// ── Pitch range ───────────────────────────────────────────────────────────────

/** Lowest note (quiet / low-value days) */
export const PITCH_MIN_HZ = 110;
/** Number of octaves spanned from min to max */
export const PITCH_OCTAVES = 3;       // 110 → 880 Hz

/**
 * Map a normalised value [0..1] to a frequency in Hz.
 * Uses exponential (musical) spacing so equal perceptual steps feel equal.
 *
 * @param {number} norm  0 = lowest pitch, 1 = highest pitch
 * @returns {number} Hz
 */
export function normToFreq(norm) {
  return PITCH_MIN_HZ * Math.pow(2, PITCH_OCTAVES * Math.max(0, Math.min(1, norm)));
}

// ── Chord / interval definitions ──────────────────────────────────────────────

export const CHORD_RATIOS = {
  fifth:   3 / 2,
  third:   5 / 4,
  unison:  1,
  tritone: Math.SQRT2,
};

export const CHORD_NAMES = {
  fifth:   "perfect fifth (3:2)",
  third:   "major third (5:4)",
  unison:  "unison (1:1)",
  tritone: "tritone (sqrt(2):1)",
};

/**
 * Map an EMA-smoothed correlation coefficient to a chord name.
 * Mirrors the deterministic logic in audioEngine.js.
 *
 * @param {number|null} rhoE
 * @returns {keyof typeof CHORD_RATIOS}
 */
export function chordStateFromRhoE(rhoE) {
  const r = rhoE ?? 0;
  if (r >  0.65) return "fifth";
  if (r >  0.25) return "third";
  if (r < -0.25) return "tritone";
  return "unison";
}

// ── Value normalisation ───────────────────────────────────────────────────────

/**
 * Normalise an array of numeric values to [0..1].
 *
 * @param {number[]} values
 * @param {'minmax'|'zscore'} method
 * @returns {number[]}
 */
export function normalizeValues(values, method = "minmax") {
  if (!values.length) return [];

  if (method === "zscore") {
    const mean  = values.reduce((s, v) => s + v, 0) / values.length;
    const sigma = Math.sqrt(
      values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length,
    ) || 1;
    // Centre at 0.5, span ±3σ → clip to [0, 1]
    return values.map((v) => Math.max(0, Math.min(1, (v - mean) / (sigma * 3) + 0.5)));
  }

  // minmax (default)
  const min   = Math.min(...values);
  const max   = Math.max(...values);
  const range = max - min || 1;
  return values.map((v) => (v - min) / range);
}

// ── Waveform synthesis helpers (pure, no Web Audio) ──────────────────────────

/**
 * Triangle wave sample from a normalised phase position [0..1).
 * Matches the "triangle" oscillator type used in audioEngine.js.
 *
 * @param {number} phaseNorm  Phase in [0, 1)
 * @returns {number} [-1, 1]
 */
export function triangleSample(phaseNorm) {
  const tp = phaseNorm % 1;
  return tp < 0.5 ? 4 * tp - 1 : 3 - 4 * tp;
}
