/**
 * Server-side audio rendering pipeline.
 *
 * Receives a validated series + mapping options, delegates to the correct
 * preset, encodes to WAV, stores in the clip store, and returns a response
 * payload matching the sonify contracts.
 */

import { renderTrendV1 }  from "./presets/trendV1.server.js";
import { renderCompareV1 } from "./presets/compareV1.server.js";
import { encodeWav }       from "./wavEncoder.server.js";
import { putClip }         from "../audio/clipStore.server.js";

const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_DURATION_MS = 2800;
const COMPARE_DURATION_MS = 3200;

/**
 * Render a single-series clip (trend_v1).
 *
 * @param {object} opts
 * @param {import('../contracts/sonify.js').SeriesDescriptor}  opts.series
 * @param {import('../contracts/sonify.js').MappingOptions}    [opts.mapping]
 * @param {import('../contracts/sonify.js').RenderOptions}     [opts.render]
 * @returns {import('../contracts/sonify.js').SonifySeriesResponse}
 */
export function renderSeriesClip({ series, mapping = {}, render = {} } = {}) {
  if (!series?.points?.length) {
    throw new Error("series.points must be a non-empty array");
  }

  const sampleRate = render.sample_rate ?? DEFAULT_SAMPLE_RATE;
  const durationMs = mapping.duration_ms ?? DEFAULT_DURATION_MS;
  const normalize  = mapping.normalize   ?? "minmax";
  const speed      = mapping.speed       ?? 1;
  const preset     = mapping.preset      ?? "trend_v1";

  if (preset !== "trend_v1") {
    throw new Error(`Unknown preset "${preset}" for renderSeriesClip — use renderCompareClip for compare_v1`);
  }

  const { samples, events } = renderTrendV1({
    points: series.points,
    durationMs,
    sampleRate,
    normalize,
    speed,
  });

  const wav = encodeWav(samples, sampleRate);
  const { clipId } = putClip({ prefix: "son", body: wav, contentType: "audio/wav" });

  return {
    audio_url: `/api/sonify/audio/${clipId}`,
    meta: {
      duration_ms: Math.round((samples.length / sampleRate) * 1000),
      events,
    },
  };
}

/**
 * Render a two-series comparison clip (compare_v1).
 *
 * @param {object} opts
 * @param {import('../contracts/sonify.js').CompareSeries}  opts.a
 * @param {import('../contracts/sonify.js').CompareSeries}  opts.b
 * @param {import('../contracts/sonify.js').MappingOptions} [opts.mapping]
 * @param {import('../contracts/sonify.js').RenderOptions}  [opts.render]
 * @returns {import('../contracts/sonify.js').SonifyCompareResponse}
 */
export function renderCompareClip({ a, b, mapping = {}, render = {} } = {}) {
  if (!a?.points?.length || !b?.points?.length) {
    throw new Error("a.points and b.points must each be non-empty arrays");
  }

  const sampleRate = render.sample_rate ?? DEFAULT_SAMPLE_RATE;
  const durationMs = mapping.duration_ms ?? COMPARE_DURATION_MS;

  const { samples, explainHint } = renderCompareV1({ a, b, durationMs, sampleRate });

  const wav = encodeWav(samples, sampleRate);
  const { clipId } = putClip({ prefix: "son", body: wav, contentType: "audio/wav" });

  return {
    audio_url: `/api/sonify/audio/${clipId}`,
    meta: {
      duration_ms: Math.round((samples.length / sampleRate) * 1000),
      explain_hint: explainHint,
    },
  };
}
