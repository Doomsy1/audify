import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateDailyFromOrders,
  summarizeDays,
  buildTimeseries,
  buildBreakdown,
} from "../toolRegistry.server.js";

test("aggregateDailyFromOrders groups orders by day and computes aov", () => {
  const days = aggregateDailyFromOrders([
    {
      created_at: "2026-02-27T09:00:00.000Z",
      current_total_price: "100.00",
      line_items: [
        { title: "Starter Bundle", quantity: 1, price: "60.00" },
        { title: "Repeat Favorite", quantity: 2, price: "20.00" },
      ],
    },
    {
      created_at: "2026-02-27T14:00:00.000Z",
      current_total_price: "50.00",
      line_items: [
        { title: "Starter Bundle", quantity: 1, price: "50.00" },
      ],
    },
  ]);

  assert.equal(days.length, 1);
  assert.equal(days[0].revenue, 150);
  assert.equal(days[0].orders, 2);
  assert.equal(days[0].aov, 75);
  assert.equal(days[0].productBreakdown[0].key, "Starter Bundle");
});

test("summarizeDays returns aggregate totals", () => {
  const summary = summarizeDays(
    [
      { dateIso: "2026-02-26T00:00:00.000Z", revenue: 120, orders: 4, aov: 30 },
      { dateIso: "2026-02-27T00:00:00.000Z", revenue: 180, orders: 6, aov: 30 },
    ],
    "last_2d",
  );

  assert.equal(summary.revenue, 300);
  assert.equal(summary.orders, 10);
  assert.equal(summary.aov, 30);
});

test("buildTimeseries maps requested metric from provided data", () => {
  const series = buildTimeseries({
    metric: "orders",
    range: "last_7d",
    bucket: "day",
    data: [
      { dateIso: "2026-02-25T00:00:00.000Z", revenue: 100, orders: 2, aov: 50 },
      { dateIso: "2026-02-26T00:00:00.000Z", revenue: 220, orders: 4, aov: 55 },
      { dateIso: "2026-02-27T00:00:00.000Z", revenue: 300, orders: 6, aov: 50 },
      { dateIso: "2026-02-28T00:00:00.000Z", revenue: 90, orders: 1, aov: 90 },
      { dateIso: "2026-03-01T00:00:00.000Z", revenue: 75, orders: 3, aov: 25 },
      { dateIso: "2026-03-02T00:00:00.000Z", revenue: 130, orders: 5, aov: 26 },
      { dateIso: "2026-03-03T00:00:00.000Z", revenue: 200, orders: 7, aov: 28.57 },
    ],
  });

  assert.equal(series.points.length, 7);
  assert.deepEqual(series.points.map((point) => point.v), [2, 4, 6, 1, 3, 5, 7]);
});

test("buildBreakdown aggregates by product and respects limit", () => {
  const breakdown = buildBreakdown({
    metric: "revenue",
    range: "today",
    limit: 2,
    data: [
      {
        dateIso: "2026-03-03T00:00:00.000Z",
        revenue: 100,
        orders: 2,
        aov: 50,
        productBreakdown: [
          { key: "A", value: 40, orders: 1 },
          { key: "B", value: 60, orders: 1 },
        ],
      },
      {
        dateIso: "2026-03-04T00:00:00.000Z",
        revenue: 140,
        orders: 2,
        aov: 70,
        productBreakdown: [
          { key: "A", value: 100, orders: 1 },
          { key: "C", value: 40, orders: 1 },
        ],
      },
    ],
  });

  assert.equal(breakdown.rows.length, 2);
  assert.equal(breakdown.rows[0].key, "A");
  assert.equal(breakdown.rows[0].value, 100);
});
