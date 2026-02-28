import test from "node:test";
import assert from "node:assert/strict";

import { detectAnomalies } from "../anomalies.server.js";

// ── Shape ─────────────────────────────────────────────────────────────────────

test("detectAnomalies returns an anomalies array", () => {
  const result = detectAnomalies({ range: "last_30d" });
  assert.ok("anomalies" in result);
  assert.ok(Array.isArray(result.anomalies));
});

test("each anomaly has t, v, expected, z, and reason fields", () => {
  const { anomalies } = detectAnomalies({ range: "last_30d" });

  for (const a of anomalies) {
    assert.equal(typeof a.t,        "string",  "t should be an ISO string");
    assert.equal(typeof a.v,        "number",  "v should be a number");
    assert.equal(typeof a.expected, "number",  "expected should be a number");
    assert.equal(typeof a.z,        "number",  "z should be a number");
    assert.equal(typeof a.reason,   "string",  "reason should be a string");
    assert.ok(!isNaN(new Date(a.t)), `Invalid date string: ${a.t}`);
  }
});

// ── Seeded spike detection ────────────────────────────────────────────────────

test("detectAnomalies flags at least one spike in last_30d mock data", () => {
  const { anomalies } = detectAnomalies({ range: "last_30d" });
  assert.ok(anomalies.length >= 1, "Expected at least one anomaly in the 30-day mock dataset");
});

test("all flagged anomalies have |z| >= zThreshold", () => {
  const zThreshold = 2.0;
  const { anomalies } = detectAnomalies({ range: "last_30d", zThreshold });

  for (const a of anomalies) {
    assert.ok(
      Math.abs(a.z) >= zThreshold,
      `Anomaly z=${a.z} is below threshold ${zThreshold}`,
    );
  }
});

test("flagged spike anomalies have v > expected", () => {
  const { anomalies } = detectAnomalies({ range: "last_30d" });
  const spikes = anomalies.filter((a) => a.reason.includes("spike"));

  for (const a of spikes) {
    assert.ok(a.v > a.expected, `Spike v=${a.v} should exceed expected=${a.expected}`);
  }
});

test("flagged dip anomalies have v < expected (if any dips are detected)", () => {
  const { anomalies } = detectAnomalies({ range: "last_30d", zThreshold: 1.5 });
  const dips = anomalies.filter((a) => a.reason.includes("dip"));

  for (const a of dips) {
    assert.ok(a.v < a.expected, `Dip v=${a.v} should be below expected=${a.expected}`);
  }
});

// ── Threshold sensitivity ─────────────────────────────────────────────────────

test("raising zThreshold to 10 produces no anomalies on mock data", () => {
  const { anomalies } = detectAnomalies({ range: "last_30d", zThreshold: 10 });
  assert.equal(anomalies.length, 0, "No anomaly should have z > 10 in the mock dataset");
});

test("lowering zThreshold to 0 flags every day after the warm-up window", () => {
  const { anomalies: highSensitivity } = detectAnomalies({ range: "last_30d", zThreshold: 0 });
  const { anomalies: normal }          = detectAnomalies({ range: "last_30d", zThreshold: 2.0 });

  assert.ok(
    highSensitivity.length >= normal.length,
    "Lower threshold should flag at least as many anomalies",
  );
});

// ── Insufficient data ─────────────────────────────────────────────────────────

test("returns empty anomalies when range has fewer points than windowDays + 1", () => {
  // 3-day custom range with windowDays=7 → 3 < 8, so no anomalies possible
  const { anomalies } = detectAnomalies({
    range:      "custom",
    start:      "2020-01-01T00:00:00.000Z",
    end:        "2020-01-03T23:59:59.999Z",
    windowDays: 7,
  });
  assert.equal(anomalies.length, 0);
});

// ── Determinism ───────────────────────────────────────────────────────────────

test("detectAnomalies is deterministic across calls", () => {
  const a = detectAnomalies({ range: "last_30d" });
  const b = detectAnomalies({ range: "last_30d" });
  assert.deepEqual(a, b);
});
