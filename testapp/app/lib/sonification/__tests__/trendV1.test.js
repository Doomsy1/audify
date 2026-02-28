import test from "node:test";
import assert from "node:assert/strict";

import { renderTrendV1 } from "../presets/trendV1.server.js";
import { normToFreq } from "../sharedMapping.js";

// ── Edge cases ────────────────────────────────────────────────────────────────

test("renderTrendV1 with empty points returns empty samples and no events", () => {
  const { samples, events } = renderTrendV1({ points: [] });
  assert.equal(samples.length, 0);
  assert.deepEqual(events, []);
});

test("renderTrendV1 with no arguments returns empty samples", () => {
  const { samples, events } = renderTrendV1();
  assert.equal(samples.length, 0);
  assert.deepEqual(events, []);
});

// ── Output shape ──────────────────────────────────────────────────────────────

test("renderTrendV1 returns a Float32Array for samples", () => {
  const { samples } = renderTrendV1({
    points: [{ t: "2026-01-01T00:00:00.000Z", v: 100 }],
  });
  assert.ok(samples instanceof Float32Array);
});

test("renderTrendV1 returns an array for events", () => {
  const { events } = renderTrendV1({
    points: [{ t: "2026-01-01T00:00:00.000Z", v: 100 }],
  });
  assert.ok(Array.isArray(events));
});

test("renderTrendV1 sample count matches floor(sampleRate * durationMs / 1000)", () => {
  const durationMs = 2800;
  const sampleRate = 24000;
  const expected   = Math.floor(sampleRate * durationMs / 1000);

  const { samples } = renderTrendV1({
    points: [
      { t: "2026-01-01T00:00:00.000Z", v: 50 },
      { t: "2026-01-02T00:00:00.000Z", v: 80 },
    ],
    durationMs,
    sampleRate,
  });

  assert.equal(samples.length, expected);
});

// ── Speed parameter ───────────────────────────────────────────────────────────

test("renderTrendV1 with speed=2 produces half as many samples as speed=1", () => {
  const points = [
    { t: "2026-01-01T00:00:00.000Z", v: 50 },
    { t: "2026-01-02T00:00:00.000Z", v: 80 },
  ];
  const opts = { points, durationMs: 2800, sampleRate: 24000 };

  const { samples: normal } = renderTrendV1({ ...opts, speed: 1 });
  const { samples: fast }   = renderTrendV1({ ...opts, speed: 2 });

  assert.equal(fast.length, Math.floor(normal.length / 2));
});

// ── Pitch mapping ─────────────────────────────────────────────────────────────

test("higher-value points produce higher frequency: last quarter of a rising series has more zero crossings than first quarter", () => {
  // Rising series: first points are low, last points are high.
  // With minmax normalization first segment → norm≈0 → ~110 Hz, last → norm=1 → ~880 Hz.
  // Count zero crossings in first quarter vs last quarter of the rendered audio.
  const points = [
    { t: "2026-01-01T00:00:00.000Z", v: 1   },
    { t: "2026-01-02T00:00:00.000Z", v: 10  },
    { t: "2026-01-03T00:00:00.000Z", v: 50  },
    { t: "2026-01-04T00:00:00.000Z", v: 100 },
  ];

  const { samples } = renderTrendV1({ points, durationMs: 2000, sampleRate: 24000 });

  function countZeroCrossings(arr, from, to) {
    let count = 0;
    for (let i = from + 1; i < to; i++) {
      if ((arr[i] >= 0) !== (arr[i - 1] >= 0)) count++;
    }
    return count;
  }

  const quarter = Math.floor(samples.length / 4);
  const lowCrossings  = countZeroCrossings(samples, 0, quarter);
  const highCrossings = countZeroCrossings(samples, samples.length - quarter, samples.length);

  assert.ok(
    highCrossings > lowCrossings,
    `Last quarter (${highCrossings} crossings) should have more than first quarter (${lowCrossings})`,
  );
});

// ── Event detection ───────────────────────────────────────────────────────────

test("renderTrendV1 detects a spike when one value is far above the mean", () => {
  const points = [
    { t: "2026-01-01T00:00:00.000Z", v: 100 },
    { t: "2026-01-02T00:00:00.000Z", v: 100 },
    { t: "2026-01-03T00:00:00.000Z", v: 100 },
    { t: "2026-01-04T00:00:00.000Z", v: 100 },
    { t: "2026-01-05T00:00:00.000Z", v: 100 },
    { t: "2026-01-06T00:00:00.000Z", v: 900 }, // clear spike
  ];

  const { events } = renderTrendV1({ points });

  const spikes = events.filter((e) => e.type === "spike");
  assert.ok(spikes.length >= 1, "Expected at least one spike event");
  assert.equal(spikes[0].t, "2026-01-06T00:00:00.000Z");
});

test("renderTrendV1 detects a dip when one value is far below the mean", () => {
  const points = [
    { t: "2026-01-01T00:00:00.000Z", v: 500 },
    { t: "2026-01-02T00:00:00.000Z", v: 500 },
    { t: "2026-01-03T00:00:00.000Z", v: 500 },
    { t: "2026-01-04T00:00:00.000Z", v: 500 },
    { t: "2026-01-05T00:00:00.000Z", v: 500 },
    { t: "2026-01-06T00:00:00.000Z", v: 10 }, // clear dip
  ];

  const { events } = renderTrendV1({ points });

  const dips = events.filter((e) => e.type === "dip");
  assert.ok(dips.length >= 1, "Expected at least one dip event");
});

test("renderTrendV1 produces no events for a flat series", () => {
  const points = Array.from({ length: 10 }, (_, i) => ({
    t: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    v: 100,
  }));

  const { events } = renderTrendV1({ points });
  assert.equal(events.length, 0, "Flat series should produce no spike/dip events");
});

test("spike event strength is in [0, 1]", () => {
  const points = [
    { t: "2026-01-01T00:00:00.000Z", v: 100 },
    { t: "2026-01-02T00:00:00.000Z", v: 100 },
    { t: "2026-01-03T00:00:00.000Z", v: 100 },
    { t: "2026-01-04T00:00:00.000Z", v: 100 },
    { t: "2026-01-05T00:00:00.000Z", v: 100 },
    { t: "2026-01-06T00:00:00.000Z", v: 9999 },
  ];

  const { events } = renderTrendV1({ points });

  for (const e of events) {
    assert.ok(e.strength >= 0 && e.strength <= 1, `Event strength ${e.strength} is out of [0,1]`);
  }
});

// ── Normalization modes ───────────────────────────────────────────────────────

test("renderTrendV1 zscore normalize produces events more pronounced for seeded spike", () => {
  const points = [
    { t: "2026-01-01T00:00:00.000Z", v: 100 },
    { t: "2026-01-02T00:00:00.000Z", v: 100 },
    { t: "2026-01-03T00:00:00.000Z", v: 100 },
    { t: "2026-01-04T00:00:00.000Z", v: 100 },
    { t: "2026-01-05T00:00:00.000Z", v: 100 },
    { t: "2026-01-06T00:00:00.000Z", v: 900 },
  ];

  const { events: minmax } = renderTrendV1({ points, normalize: "minmax" });
  const { events: zscore } = renderTrendV1({ points, normalize: "zscore" });

  // Both should detect the spike
  assert.ok(minmax.length >= 1, "minmax should detect the spike");
  assert.ok(zscore.length >= 1, "zscore should detect the spike");
});

// ── Sample values ─────────────────────────────────────────────────────────────

test("renderTrendV1 samples are in approximately [-1.2, 1.2] (tick bursts may slightly exceed 1)", () => {
  const points = Array.from({ length: 7 }, (_, i) => ({
    t: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    v: (i + 1) * 100,
  }));

  const { samples } = renderTrendV1({ points, durationMs: 1000, sampleRate: 24000 });

  for (let i = 0; i < samples.length; i++) {
    assert.ok(
      samples[i] >= -1.2 && samples[i] <= 1.2,
      `Sample[${i}] = ${samples[i]} is outside expected range`,
    );
  }
});

test("renderTrendV1 fade-in: first sample is near 0", () => {
  const points = [
    { t: "2026-01-01T00:00:00.000Z", v: 100 },
    { t: "2026-01-02T00:00:00.000Z", v: 200 },
  ];

  const { samples } = renderTrendV1({ points, durationMs: 500, sampleRate: 24000 });

  assert.ok(
    Math.abs(samples[0]) < 0.01,
    `First sample should be near 0 (fade-in), got ${samples[0]}`,
  );
});
