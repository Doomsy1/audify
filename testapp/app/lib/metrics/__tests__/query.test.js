import test from "node:test";
import assert from "node:assert/strict";

import { querySummary, queryCompare, queryTimeseries, queryBreakdown } from "../query.server.js";

// ── querySummary ──────────────────────────────────────────────────────────────

test("querySummary returns required top-level keys", () => {
  const result = querySummary({ range: "last_30d" });

  assert.ok("range"   in result);
  assert.ok("start"   in result);
  assert.ok("end"     in result);
  assert.ok("revenue" in result);
  assert.ok("orders"  in result);
  assert.ok("aov"     in result);
});

test("querySummary revenue and orders are non-negative numbers", () => {
  const result = querySummary({ range: "last_30d" });

  assert.equal(typeof result.revenue, "number");
  assert.equal(typeof result.orders, "number");
  assert.equal(typeof result.aov, "number");
  assert.ok(result.revenue >= 0);
  assert.ok(result.orders >= 0);
  assert.ok(result.aov >= 0);
});

test("querySummary aov equals revenue / orders (within floating point)", () => {
  const result = querySummary({ range: "last_30d" });

  if (result.orders === 0) {
    assert.equal(result.aov, 0);
  } else {
    const expectedAov = Math.round((result.revenue / result.orders) * 100) / 100;
    assert.equal(result.aov, expectedAov);
  }
});

test("querySummary is deterministic — same call twice returns identical output", () => {
  const a = querySummary({ range: "last_30d" });
  const b = querySummary({ range: "last_30d" });

  assert.deepEqual(a, b);
});

test("querySummary start and end are valid ISO-8601 strings", () => {
  const { start, end } = querySummary({ range: "last_7d" });

  assert.doesNotThrow(() => new Date(start));
  assert.doesNotThrow(() => new Date(end));
  assert.ok(!isNaN(new Date(start)));
  assert.ok(!isNaN(new Date(end)));
  assert.ok(new Date(start) < new Date(end));
});

test("querySummary with custom range returns expected range label", () => {
  const result = querySummary({
    range: "custom",
    start: "2026-01-01T00:00:00.000Z",
    end:   "2026-01-07T23:59:59.999Z",
  });
  assert.equal(result.range, "custom");
});

// ── queryCompare ──────────────────────────────────────────────────────────────

test("queryCompare returns base, compare_to, and deltas", () => {
  const result = queryCompare({ range: "last_7d" });

  assert.ok("base"       in result);
  assert.ok("compare_to" in result);
  assert.ok("deltas"     in result);
});

test("queryCompare base has correct range label", () => {
  const result = queryCompare({ range: "last_7d" });
  assert.equal(result.base.range, "last_7d");
});

test("queryCompare deltas are mathematically consistent with base and compare_to", () => {
  const { base, compare_to, deltas } = queryCompare({ range: "last_30d" });

  const expectedRevenueAbs = Math.round((base.revenue - compare_to.revenue) * 100) / 100;
  assert.equal(deltas.revenue_abs, expectedRevenueAbs);

  const expectedOrdersAbs = base.orders - compare_to.orders;
  assert.equal(deltas.orders_abs, expectedOrdersAbs);
});

test("queryCompare delta signs are correct when base < compare_to", () => {
  // Use a fixed custom range that falls in the first few mock days (low traffic)
  // vs a preceding period that includes spike days — or just verify sign consistency.
  const { base, compare_to, deltas } = queryCompare({ range: "last_30d" });

  if (base.revenue > compare_to.revenue) {
    assert.ok(deltas.revenue_abs > 0);
    assert.ok(deltas.revenue_pct > 0);
  } else if (base.revenue < compare_to.revenue) {
    assert.ok(deltas.revenue_abs < 0);
    assert.ok(deltas.revenue_pct < 0);
  } else {
    assert.equal(deltas.revenue_abs, 0);
    assert.equal(deltas.revenue_pct, 0);
  }
});

// ── queryTimeseries ───────────────────────────────────────────────────────────

test("queryTimeseries returns metric, bucket, and points array", () => {
  const result = queryTimeseries({ metric: "revenue", bucket: "day", range: "last_7d" });

  assert.equal(result.metric, "revenue");
  assert.equal(result.bucket, "day");
  assert.ok(Array.isArray(result.points));
});

test("queryTimeseries last_7d returns at least 7 points", () => {
  const { points } = queryTimeseries({ metric: "revenue", bucket: "day", range: "last_7d" });
  assert.ok(points.length >= 7, `Expected >= 7 points, got ${points.length}`);
});

test("queryTimeseries each point has t (ISO string) and v (number)", () => {
  const { points } = queryTimeseries({ metric: "revenue", bucket: "day", range: "last_7d" });

  for (const pt of points) {
    assert.equal(typeof pt.t, "string");
    assert.equal(typeof pt.v, "number");
    assert.ok(!isNaN(new Date(pt.t)), `Invalid date: ${pt.t}`);
    assert.ok(pt.v >= 0);
  }
});

test("queryTimeseries points are sorted chronologically", () => {
  const { points } = queryTimeseries({ metric: "revenue", bucket: "day", range: "last_30d" });

  for (let i = 1; i < points.length; i++) {
    assert.ok(
      points[i].t > points[i - 1].t,
      `Points not sorted at index ${i}: ${points[i - 1].t} → ${points[i].t}`,
    );
  }
});

test("queryTimeseries fills missing days with 0", () => {
  // Use a custom 3-day range over a fixed period known to have no mock orders
  // (Jan 1–3 is well outside the 30-day mock window at any realistic test date).
  const { points } = queryTimeseries({
    metric: "revenue",
    bucket: "day",
    range:  "custom",
    start:  "2020-01-01T00:00:00.000Z",
    end:    "2020-01-03T23:59:59.999Z",
  });

  assert.equal(points.length, 3);
  for (const pt of points) {
    assert.equal(pt.v, 0);
  }
});

test("queryTimeseries orders metric returns integer counts", () => {
  const { points } = queryTimeseries({ metric: "orders", bucket: "day", range: "last_30d" });

  for (const pt of points) {
    assert.equal(pt.v, Math.floor(pt.v), `orders count should be integer, got ${pt.v}`);
  }
});

test("queryTimeseries is deterministic", () => {
  const a = queryTimeseries({ metric: "revenue", bucket: "day", range: "last_30d" });
  const b = queryTimeseries({ metric: "revenue", bucket: "day", range: "last_30d" });
  assert.deepEqual(a, b);
});

// ── queryBreakdown ────────────────────────────────────────────────────────────

test("queryBreakdown returns metric, by, and rows array", () => {
  const result = queryBreakdown({ metric: "revenue", by: "product", range: "last_30d" });

  assert.equal(result.metric, "revenue");
  assert.equal(result.by, "product");
  assert.ok(Array.isArray(result.rows));
});

test("queryBreakdown rows have key, value, and orders fields", () => {
  const { rows } = queryBreakdown({ metric: "revenue", by: "product", range: "last_30d" });

  assert.ok(rows.length > 0, "Expected at least one breakdown row");

  for (const row of rows) {
    assert.equal(typeof row.key,    "string");
    assert.equal(typeof row.value,  "number");
    assert.equal(typeof row.orders, "number");
    assert.ok(row.value  >= 0);
    assert.ok(row.orders >= 0);
  }
});

test("queryBreakdown rows are sorted by value descending", () => {
  const { rows } = queryBreakdown({ metric: "revenue", by: "product", range: "last_30d" });

  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      rows[i].value <= rows[i - 1].value,
      `Rows not sorted at index ${i}: ${rows[i - 1].value} → ${rows[i].value}`,
    );
  }
});

test("queryBreakdown total value is consistent with summary revenue (within rounding)", () => {
  const { revenue } = querySummary({ range: "last_30d" });
  const { rows }    = queryBreakdown({ metric: "revenue", by: "product", range: "last_30d" });

  const breakdownTotal = Math.round(rows.reduce((s, r) => s + r.value, 0) * 100) / 100;
  const diff = Math.abs(breakdownTotal - revenue);

  // Allow small floating-point rounding drift across rows
  assert.ok(diff < 1, `Breakdown total ${breakdownTotal} differs from summary ${revenue} by ${diff}`);
});
