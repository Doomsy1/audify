import test from "node:test";
import assert from "node:assert/strict";

import { parseRange, previousPeriod } from "../ranges.server.js";

// ── parseRange ────────────────────────────────────────────────────────────────

test("parseRange today: start is midnight UTC, end is 23:59:59.999 UTC", () => {
  const { start, end } = parseRange({ range: "today" });

  assert.equal(start.getUTCHours(), 0);
  assert.equal(start.getUTCMinutes(), 0);
  assert.equal(start.getUTCSeconds(), 0);
  assert.equal(start.getUTCMilliseconds(), 0);

  assert.equal(end.getUTCHours(), 23);
  assert.equal(end.getUTCMinutes(), 59);
  assert.equal(end.getUTCSeconds(), 59);
  assert.equal(end.getUTCMilliseconds(), 999);

  assert.equal(start.getUTCFullYear(), end.getUTCFullYear());
  assert.equal(start.getUTCMonth(), end.getUTCMonth());
  assert.equal(start.getUTCDate(), end.getUTCDate());
});

test("parseRange yesterday: start and end are on the same day, one day before today", () => {
  const today = new Date();
  const { start, end } = parseRange({ range: "yesterday" });

  const expectedDate = today.getUTCDate() - 1;

  assert.equal(start.getUTCDate(), expectedDate);
  assert.equal(end.getUTCDate(), expectedDate);

  assert.equal(start.getUTCHours(), 0);
  assert.equal(end.getUTCHours(), 23);
  assert.equal(end.getUTCMilliseconds(), 999);
});

test("parseRange last_7d: start is 7 days before today, end is end of today", () => {
  const { start, end } = parseRange({ range: "last_7d" });

  const spanDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  assert.ok(spanDays >= 7 && spanDays <= 8, `Expected span ~7-8 days, got ${spanDays}`);

  assert.equal(start.getUTCHours(), 0);
  assert.equal(end.getUTCHours(), 23);
  assert.equal(end.getUTCMilliseconds(), 999);
});

test("parseRange last_30d: span is approximately 30 days", () => {
  const { start, end } = parseRange({ range: "last_30d" });

  const spanDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  assert.ok(spanDays >= 30 && spanDays <= 31, `Expected span ~30-31 days, got ${spanDays}`);
});

test("parseRange custom: returns the exact dates provided", () => {
  const s = "2026-01-01T00:00:00.000Z";
  const e = "2026-01-07T23:59:59.999Z";

  const { start, end } = parseRange({ range: "custom", start: s, end: e });

  assert.equal(start.toISOString(), s);
  assert.equal(end.toISOString(), e);
});

test("parseRange custom without start/end throws", () => {
  assert.throws(
    () => parseRange({ range: "custom" }),
    /requires start and end/,
  );
});

test("parseRange custom with invalid date throws", () => {
  assert.throws(
    () => parseRange({ range: "custom", start: "not-a-date", end: "2026-01-07" }),
    /Invalid start or end date/,
  );
});

test("parseRange custom where start > end throws", () => {
  assert.throws(
    () => parseRange({ range: "custom", start: "2026-01-10", end: "2026-01-01" }),
    /start must be before end/,
  );
});

test("parseRange unknown preset throws", () => {
  assert.throws(
    () => parseRange({ range: "last_year" }),
    /Unknown range preset/,
  );
});

test("parseRange defaults to last_30d when range is omitted", () => {
  const { start, end } = parseRange({});
  const spanDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  assert.ok(spanDays >= 30 && spanDays <= 31);
});

// ── previousPeriod ────────────────────────────────────────────────────────────

test("previousPeriod returns a window of equal duration immediately before the input", () => {
  const start = new Date("2026-01-08T00:00:00.000Z");
  const end   = new Date("2026-01-14T23:59:59.999Z");

  const { start: ps, end: pe } = previousPeriod({ start, end });

  // Duration of both windows should be equal
  const inputDuration = end.getTime() - start.getTime();
  const prevDuration  = pe.getTime() - ps.getTime();
  assert.equal(prevDuration, inputDuration);

  // Previous window should end exactly 1ms before input start
  assert.equal(pe.getTime(), start.getTime() - 1);
});

test("previousPeriod: previous window starts at correct date", () => {
  const start = new Date("2026-01-15T00:00:00.000Z");
  const end   = new Date("2026-01-21T23:59:59.999Z");

  const { start: ps } = previousPeriod({ start, end });

  // 7-day window (plus fractional ms) should shift back by ~7 days
  const daysBefore = (start.getTime() - ps.getTime()) / (1000 * 60 * 60 * 24);
  assert.ok(daysBefore >= 6.9 && daysBefore <= 7.1, `Expected ~7 days before, got ${daysBefore}`);
});
