/**
 * Aggregation layer — computes summary, timeseries, breakdown, and compare results
 * from the data returned by repository.server.js.
 */

import { parseRange, previousPeriod } from "./ranges.server.js";
import { getOrdersInRange } from "./repository.server.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(n) {
  return Math.round(n * 100) / 100;
}

function pctChange(next, prev) {
  if (prev === 0) return next === 0 ? 0 : 100;
  return round2(((next - prev) / prev) * 100);
}

/** @param {string} iso Date key to group by day (YYYY-MM-DD) */
function dayKey(iso) {
  return iso.slice(0, 10);
}

// ── Summary ───────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} [opts.range='last_30d']
 * @param {string} [opts.start]
 * @param {string} [opts.end]
 * @param {string} [opts.tz]
 * @returns {import('../contracts/metrics.js').SummaryResponse}
 */
export function querySummary({ range = "last_30d", start, end, tz } = {}) {
  const window = parseRange({ range, start, end, tz });
  const orders = getOrdersInRange(window.start, window.end);

  const revenue = orders.reduce((s, o) => s + o.totalPrice, 0);
  const orderCount = orders.length;
  const aov = orderCount ? revenue / orderCount : 0;

  return {
    range,
    start: window.start.toISOString(),
    end:   window.end.toISOString(),
    revenue:  round2(revenue),
    orders:   orderCount,
    aov:      round2(aov),
  };
}

// ── Compare ───────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} [opts.range='last_7d']
 * @param {string} [opts.start]
 * @param {string} [opts.end]
 * @param {string} [opts.tz]
 * @returns {import('../contracts/metrics.js').CompareResponse}
 */
export function queryCompare({ range = "last_7d", start, end, tz } = {}) {
  const window = parseRange({ range, start, end, tz });
  const prev   = previousPeriod(window);

  const ordersBase = getOrdersInRange(window.start, window.end);
  const ordersPrev = getOrdersInRange(prev.start, prev.end);

  function agg(orders) {
    const revenue = orders.reduce((s, o) => s + o.totalPrice, 0);
    const count   = orders.length;
    return {
      revenue: round2(revenue),
      orders:  count,
      aov:     round2(count ? revenue / count : 0),
    };
  }

  const base = agg(ordersBase);
  const cmp  = agg(ordersPrev);

  return {
    base:       { range, ...base },
    compare_to: { range: "previous_period", ...cmp },
    deltas: {
      revenue_abs: round2(base.revenue - cmp.revenue),
      revenue_pct: pctChange(base.revenue, cmp.revenue),
      orders_abs:  base.orders - cmp.orders,
      orders_pct:  pctChange(base.orders, cmp.orders),
      aov_abs:     round2(base.aov - cmp.aov),
      aov_pct:     pctChange(base.aov, cmp.aov),
    },
  };
}

// ── Timeseries ────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {'revenue'|'orders'|'aov'} [opts.metric='revenue']
 * @param {'day'} [opts.bucket='day']
 * @param {string} [opts.range='last_7d']
 * @param {string} [opts.start]
 * @param {string} [opts.end]
 * @param {string} [opts.tz]
 * @returns {import('../contracts/metrics.js').TimeseriesResponse}
 */
export function queryTimeseries({
  metric = "revenue",
  bucket = "day",
  range  = "last_7d",
  start,
  end,
  tz,
} = {}) {
  const window = parseRange({ range, start, end, tz });
  const orders = getOrdersInRange(window.start, window.end);

  // Build per-day buckets
  const buckets = {};
  for (const order of orders) {
    const key = dayKey(order.createdAt);
    if (!buckets[key]) buckets[key] = { revenue: 0, orders: 0 };
    buckets[key].revenue += order.totalPrice;
    buckets[key].orders  += 1;
  }

  // Fill any missing days in range with 0
  const cursor = new Date(window.start);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= window.end) {
    const key = dayKey(cursor.toISOString());
    if (!buckets[key]) buckets[key] = { revenue: 0, orders: 0 };
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const points = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => {
      let v;
      if (metric === "orders")  v = data.orders;
      else if (metric === "aov") v = data.orders ? round2(data.revenue / data.orders) : 0;
      else                       v = round2(data.revenue);
      return { t: `${date}T00:00:00.000Z`, v };
    });

  return { metric, bucket, points };
}

// ── Breakdown ─────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {'revenue'|'orders'} [opts.metric='revenue']
 * @param {'product'} [opts.by='product']
 * @param {string} [opts.range='last_30d']
 * @param {string} [opts.start]
 * @param {string} [opts.end]
 * @param {string} [opts.tz]
 * @returns {import('../contracts/metrics.js').BreakdownResponse}
 */
export function queryBreakdown({
  metric = "revenue",
  by     = "product",
  range  = "last_30d",
  start,
  end,
  tz,
} = {}) {
  const window = parseRange({ range, start, end, tz });
  const orders = getOrdersInRange(window.start, window.end);

  const rows = {};
  for (const order of orders) {
    for (const item of order.lineItems) {
      const key = item.title;
      if (!rows[key]) rows[key] = { key, value: 0, orders: 0 };
      rows[key].value  += item.price * item.quantity;
      rows[key].orders += 1;
    }
  }

  return {
    metric,
    by,
    rows: Object.values(rows)
      .sort((a, b) => b.value - a.value)
      .map((r) => ({ ...r, value: round2(r.value) })),
  };
}
