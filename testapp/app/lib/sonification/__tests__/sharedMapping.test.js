import test from "node:test";
import assert from "node:assert/strict";

import {
  normToFreq,
  normalizeValues,
  triangleSample,
  chordStateFromRhoE,
  PITCH_MIN_HZ,
  PITCH_OCTAVES,
  CHORD_RATIOS,
} from "../sharedMapping.js";

// ── normToFreq ────────────────────────────────────────────────────────────────

test("normToFreq(0) returns PITCH_MIN_HZ", () => {
  assert.equal(normToFreq(0), PITCH_MIN_HZ);
});

test("normToFreq(1) returns PITCH_MIN_HZ * 2^PITCH_OCTAVES", () => {
  const expected = PITCH_MIN_HZ * Math.pow(2, PITCH_OCTAVES);
  assert.equal(normToFreq(1), expected);
});

test("normToFreq is monotonically increasing between 0 and 1", () => {
  const steps = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
  for (let i = 1; i < steps.length; i++) {
    assert.ok(
      normToFreq(steps[i]) > normToFreq(steps[i - 1]),
      `normToFreq(${steps[i]}) should be > normToFreq(${steps[i - 1]})`,
    );
  }
});

test("normToFreq clamps values below 0 to normToFreq(0)", () => {
  assert.equal(normToFreq(-1), normToFreq(0));
  assert.equal(normToFreq(-100), normToFreq(0));
});

test("normToFreq clamps values above 1 to normToFreq(1)", () => {
  assert.equal(normToFreq(2), normToFreq(1));
  assert.equal(normToFreq(100), normToFreq(1));
});

test("normToFreq(0.5) is the geometric mean of min and max frequencies", () => {
  const min = normToFreq(0);
  const max = normToFreq(1);
  const geoMean = Math.sqrt(min * max);
  const actual  = normToFreq(0.5);

  // Within 1 Hz of the geometric mean (exponential spacing)
  assert.ok(
    Math.abs(actual - geoMean) < 1,
    `normToFreq(0.5)=${actual} should be near geometric mean ${geoMean}`,
  );
});

// ── normalizeValues ───────────────────────────────────────────────────────────

test("normalizeValues minmax: min→0, max→1", () => {
  const result = normalizeValues([10, 20, 30], "minmax");
  assert.equal(result[0], 0);
  assert.equal(result[2], 1);
});

test("normalizeValues minmax: middle value is proportional", () => {
  const result = normalizeValues([0, 50, 100], "minmax");
  assert.equal(result[1], 0.5);
});

test("normalizeValues minmax: all identical values → all 0 (range floors to 1)", () => {
  const result = normalizeValues([5, 5, 5], "minmax");
  for (const v of result) assert.equal(v, 0);
});

test("normalizeValues zscore: mean maps to 0.5", () => {
  const values = [1, 2, 3, 4, 5];
  const result = normalizeValues(values, "zscore");
  const mean   = values.reduce((s, v) => s + v, 0) / values.length;
  const meanIdx = values.indexOf(mean);

  // For symmetric distribution, value closest to mean → closest to 0.5
  // Find the value closest to mean and verify its normalized value is closest to 0.5
  const distances = result.map((v) => Math.abs(v - 0.5));
  const minDist   = Math.min(...distances);
  assert.ok(minDist < 0.1, `Mean value should normalize close to 0.5, min distance was ${minDist}`);
});

test("normalizeValues zscore: output values are in [0, 1]", () => {
  const values = [1, 100, 2, 99, 50, 3, 97];
  const result = normalizeValues(values, "zscore");
  for (const v of result) {
    assert.ok(v >= 0 && v <= 1, `zscore-normalized value ${v} is out of [0,1]`);
  }
});

test("normalizeValues returns empty array for empty input", () => {
  assert.deepEqual(normalizeValues([], "minmax"), []);
  assert.deepEqual(normalizeValues([], "zscore"), []);
});

test("normalizeValues preserves order", () => {
  const values = [3, 1, 4, 1, 5, 9];
  const result = normalizeValues(values, "minmax");
  assert.equal(result.length, values.length);

  // Larger input → larger or equal normalized output
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values.length; j++) {
      if (values[i] > values[j]) {
        assert.ok(result[i] >= result[j]);
      }
    }
  }
});

// ── triangleSample ────────────────────────────────────────────────────────────

test("triangleSample(0) returns -1 (start of wave)", () => {
  assert.equal(triangleSample(0), -1);
});

test("triangleSample(0.25) returns 0 (zero crossing up)", () => {
  assert.equal(triangleSample(0.25), 0);
});

test("triangleSample(0.5) returns 1 (peak)", () => {
  assert.equal(triangleSample(0.5), 1);
});

test("triangleSample(0.75) returns 0 (zero crossing down)", () => {
  assert.equal(triangleSample(0.75), 0);
});

test("triangleSample output is always in [-1, 1]", () => {
  for (let i = 0; i <= 100; i++) {
    const phase = i / 100;
    const s = triangleSample(phase);
    assert.ok(s >= -1 && s <= 1, `triangleSample(${phase}) = ${s} is out of [-1,1]`);
  }
});

test("triangleSample(1.0) wraps correctly (same as triangleSample(0))", () => {
  assert.equal(triangleSample(1.0), triangleSample(0));
});

// ── chordStateFromRhoE ────────────────────────────────────────────────────────

test("chordStateFromRhoE returns 'fifth' for rhoE > 0.65", () => {
  assert.equal(chordStateFromRhoE(0.7),  "fifth");
  assert.equal(chordStateFromRhoE(1.0),  "fifth");
});

test("chordStateFromRhoE returns 'third' for 0.25 < rhoE <= 0.65", () => {
  assert.equal(chordStateFromRhoE(0.3),  "third");
  assert.equal(chordStateFromRhoE(0.65), "third");
});

test("chordStateFromRhoE returns 'tritone' for rhoE < -0.25", () => {
  assert.equal(chordStateFromRhoE(-0.5), "tritone");
  assert.equal(chordStateFromRhoE(-1.0), "tritone");
});

test("chordStateFromRhoE returns 'unison' for -0.25 <= rhoE <= 0.25", () => {
  assert.equal(chordStateFromRhoE(0),     "unison");
  assert.equal(chordStateFromRhoE(0.1),   "unison");
  assert.equal(chordStateFromRhoE(-0.1),  "unison");
});

test("chordStateFromRhoE handles null/undefined as 0", () => {
  assert.equal(chordStateFromRhoE(null),      "unison");
  assert.equal(chordStateFromRhoE(undefined), "unison");
});

// ── CHORD_RATIOS sanity ───────────────────────────────────────────────────────

test("CHORD_RATIOS.unison is exactly 1", () => {
  assert.equal(CHORD_RATIOS.unison, 1);
});

test("CHORD_RATIOS.fifth is 3/2 (perfect fifth)", () => {
  assert.equal(CHORD_RATIOS.fifth, 3 / 2);
});

test("CHORD_RATIOS.third is 5/4 (major third)", () => {
  assert.equal(CHORD_RATIOS.third, 5 / 4);
});

test("CHORD_RATIOS.tritone is sqrt(2)", () => {
  assert.ok(Math.abs(CHORD_RATIOS.tritone - Math.SQRT2) < 1e-10);
});
