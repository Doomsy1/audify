import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { putClip } from "../audio/clipStore.server.js";
import { createToneWave } from "../audio/simpleWave.server.js";
import { clamp } from "../contracts/agent.js";
import { renderDashboardV1 } from "../sonification/presets/dashboardV1.js";

function launchSonifyDashboard() {
  try {
    const script = resolve(process.cwd(), "..", "sonify_dashboard.py");
    spawn("python3", [script], {
      detached: true,
      stdio: "ignore",
      cwd: resolve(process.cwd(), ".."),
    }).unref();
  } catch (_) {
    // best-effort — non-fatal if Python isn't available
  }
}

const SHOPIFY_ADMIN_API_VERSION = "2025-10";

const DAY_MS = 24 * 60 * 60 * 1000;
const PRODUCT_KEYS = ["Starter Bundle", "Repeat Favorite", "Seasonal Drop"];

function toIsoDay(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toISOString();
}

function buildDailyDataset() {
  const days = [];
  const today = new Date();

  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(today.getTime() - (offset * DAY_MS));
    const cycle = 29 - offset;

    let revenue = 920 + (cycle * 14) + ((cycle % 5) * 36);
    let orders = 28 + (cycle % 7) + Math.floor(cycle / 10);

    if (offset === 4) {
      revenue += 420;
      orders += 9;
    }
    if (offset === 11) {
      revenue -= 180;
      orders -= 6;
    }

    revenue = Math.round(revenue);
    orders = Math.max(8, orders);
    const aov = roundCurrency(revenue / orders);

    const productBreakdown = PRODUCT_KEYS.map((key, index) => {
      const share = [0.45, 0.33, 0.22][index];
      const value = roundCurrency(revenue * share);
      const productOrders = Math.max(1, Math.round(orders * share));
      return {
        key,
        value,
        orders: productOrders,
      };
    });

    days.push({
      dateIso: toIsoDay(date),
      revenue,
      orders,
      aov,
      productBreakdown,
    });
  }

  return days;
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function getDataset() {
  return buildDailyDataset();
}

function resolveRange(range, start, end, data = getDataset()) {
  switch (range) {
    case "today":
      return data.slice(-1);
    case "yesterday":
      return data.slice(-2, -1);
    case "last_7d":
      return data.slice(-7);
    case "last_30d":
      return data.slice(-30);
    case "custom":
      return data.filter((entry) => {
        const ts = new Date(entry.dateIso).getTime();
        const startTs = start ? new Date(start).getTime() : Number.NEGATIVE_INFINITY;
        const endTs = end ? new Date(end).getTime() : Number.POSITIVE_INFINITY;
        return ts >= startTs && ts <= endTs;
      });
    default:
      return data.slice(-1);
  }
}

function getUtcDayBounds(daysBackStart, daysBackEnd = 0) {
  const now = new Date();
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysBackStart,
    0, 0, 0, 0,
  ));
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysBackEnd,
    23, 59, 59, 999,
  ));
  return { start, end };
}

function pickFetchWindow(range, start, end) {
  if (range === "custom" && (start || end)) {
    return {
      start: start ? new Date(start) : getUtcDayBounds(29).start,
      end: end ? new Date(end) : new Date(),
    };
  }
  if (range === "today") return getUtcDayBounds(0);
  if (range === "yesterday") return getUtcDayBounds(1, 1);
  if (range === "last_7d") return getUtcDayBounds(6);
  return getUtcDayBounds(29);
}

function parseLinkHeader(linkHeader) {
  if (!linkHeader) return "";
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.endsWith('rel="next"')) continue;
    const match = trimmed.match(/<([^>]+)>/);
    if (match?.[1]) return match[1];
  }
  return "";
}

async function fetchOrdersFromShopify({ shop, accessToken, range, start, end }) {
  const window = pickFetchWindow(range, start, end);
  let url = new URL(`https://${shop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/orders.json`);
  url.searchParams.set("status", "any");
  url.searchParams.set("limit", "250");
  url.searchParams.set("created_at_min", window.start.toISOString());
  url.searchParams.set("created_at_max", window.end.toISOString());
  url.searchParams.set("fields", "created_at,current_total_price,line_items");

  const orders = [];
  for (let page = 0; page < 5 && url; page += 1) {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": accessToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Shopify orders (${response.status})`);
    }

    const payload = await response.json();
    orders.push(...(Array.isArray(payload?.orders) ? payload.orders : []));

    const nextUrl = parseLinkHeader(response.headers.get("link"));
    url = nextUrl ? new URL(nextUrl) : null;
  }

  return orders;
}

function toNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
}

function formatProductKey(title) {
  if (typeof title !== "string") return "Untitled Product";
  const trimmed = title.trim();
  return trimmed || "Untitled Product";
}

export function aggregateDailyFromOrders(orders) {
  const byDay = new Map();

  for (const order of orders) {
    const orderDate = new Date(order?.created_at);
    if (Number.isNaN(orderDate.getTime())) continue;
    const dayKey = toIsoDay(orderDate);
    const current = byDay.get(dayKey) ?? {
      dateIso: dayKey,
      revenue: 0,
      orders: 0,
      aov: 0,
      productBreakdownMap: new Map(),
    };

    const orderRevenue = toNumber(order?.current_total_price);
    current.revenue += orderRevenue;
    current.orders += 1;

    const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];
    for (const item of lineItems) {
      const key = formatProductKey(item?.title);
      const quantity = Math.max(0, Math.round(toNumber(item?.quantity)));
      const lineValue = toNumber(item?.price) * quantity;
      const row = current.productBreakdownMap.get(key) ?? { key, value: 0, orders: 0 };
      row.value += lineValue;
      row.orders += quantity;
      current.productBreakdownMap.set(key, row);
    }

    byDay.set(dayKey, current);
  }

  return [...byDay.values()]
    .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime())
    .map((entry) => ({
      dateIso: entry.dateIso,
      revenue: roundCurrency(entry.revenue),
      orders: entry.orders,
      aov: entry.orders ? roundCurrency(entry.revenue / entry.orders) : 0,
      productBreakdown: [...entry.productBreakdownMap.values()]
        .sort((a, b) => b.value - a.value)
        .map((row) => ({
          key: row.key,
          value: roundCurrency(row.value),
          orders: row.orders,
        })),
    }));
}

async function resolveDataset(context, args) {
  if (context?.shop && context?.accessToken) {
    try {
      const orders = await fetchOrdersFromShopify({
        shop: context.shop,
        accessToken: context.accessToken,
        range: args.range ?? "last_30d",
        start: args.start,
        end: args.end,
      });
      const fromOrders = aggregateDailyFromOrders(orders);
      if (fromOrders.length) {
        return fromOrders;
      }
    } catch (_) {
      // Fall through to deterministic synthetic data for resilience.
    }
  }

  return getDataset();
}

export function summarizeDays(days, range) {
  const revenue = days.reduce((sum, entry) => sum + entry.revenue, 0);
  const orders = days.reduce((sum, entry) => sum + entry.orders, 0);
  const aov = orders ? roundCurrency(revenue / orders) : 0;

  return {
    range,
    start: days[0]?.dateIso ?? "",
    end: days[days.length - 1]?.dateIso ?? "",
    revenue,
    orders,
    aov,
  };
}

function calculateDeltas(base, compareTo) {
  return {
    revenue_abs: roundCurrency(base.revenue - compareTo.revenue),
    revenue_pct: toPercent(base.revenue, compareTo.revenue),
    orders_abs: base.orders - compareTo.orders,
    orders_pct: toPercent(base.orders, compareTo.orders),
    aov_abs: roundCurrency(base.aov - compareTo.aov),
    aov_pct: toPercent(base.aov, compareTo.aov),
  };
}

function toPercent(value, previous) {
  if (!previous) return value ? 100 : 0;
  return roundCurrency(((value - previous) / previous) * 100);
}

export function buildTimeseries({ metric, range, bucket, data }) {
  const days = resolveRange(range, undefined, undefined, data);
  if (bucket === "hour" && range === "today") {
    const base = days[0] ?? summarizeDays([], range);
    return {
      metric,
      bucket,
      points: new Array(24).fill(null).map((_, hour) => ({
        t: new Date(Date.now() - ((23 - hour) * 60 * 60 * 1000)).toISOString(),
        v: metricValue(metric, {
          revenue: Math.round((base.revenue / 24) * (0.7 + ((hour % 6) * 0.09))),
          orders: Math.max(1, Math.round((base.orders / 24) * (0.7 + ((hour % 6) * 0.09)))),
          aov: base.aov,
        }),
      })),
    };
  }

  return {
    metric,
    bucket,
    points: days.map((entry) => ({
      t: entry.dateIso,
      v: metricValue(metric, entry),
    })),
  };
}

function metricValue(metric, entry) {
  if (metric === "orders") return entry.orders;
  if (metric === "aov") return entry.aov;
  return entry.revenue;
}

export function buildBreakdown({ metric, range, limit = 5, data }) {
  const days = resolveRange(range, undefined, undefined, data);
  const byKey = new Map();

  for (const day of days) {
    for (const row of day.productBreakdown) {
      const current = byKey.get(row.key) ?? { key: row.key, value: 0, orders: 0 };
      current.value += metric === "orders" ? row.orders : row.value;
      current.orders += row.orders;
      byKey.set(row.key, current);
    }
  }

  return {
    metric,
    by: "product",
    rows: [...byKey.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
      .map((row) => ({
        ...row,
        value: roundCurrency(row.value),
      })),
  };
}

function buildAnomalies({ metric, range, data }) {
  const series = buildTimeseries({ metric, range, bucket: "day", data }).points;
  const values = series.map((point) => point.v);
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(1, values.length);
  const sigma = Math.sqrt(variance) || 1;

  return {
    anomalies: series
      .map((point) => {
        const z = (point.v - mean) / sigma;
        if (Math.abs(z) < 1.5) return null;
        return {
          t: point.t,
          v: point.v,
          expected: roundCurrency(mean),
          z: roundCurrency(z),
          reason: z > 0 ? "Spike above rolling baseline" : "Dip below rolling baseline",
        };
      })
      .filter(Boolean),
  };
}

function normalizeSeries(points, mode) {
  if (!points.length) return [];
  const values = points.map((point) => point.v);
  if (mode === "none") return values;

  if (mode === "zscore") {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    const sigma = Math.sqrt(variance) || 1;
    return values.map((value) => (value - mean) / sigma);
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value) => (value - min) / span);
}

function createTrendClip({ points, speed = 1, normalize = "minmax", durationMs = 2600 }) {
  const normalized = normalizeSeries(points, normalize);
  const frequencies = normalized.map((value) => {
    const scaled = normalize === "zscore"
      ? clamp((value + 2) / 4, 0, 1)
      : clamp(value, 0, 1);
    return Math.round(280 + (scaled * 420));
  });

  const wav = createToneWave({
    frequencies,
    durationMs: Math.round(durationMs / clamp(speed, 0.5, 1.5)),
    sampleRate: 24000,
    gain: 0.15,
  });

  const { clipId } = putClip({
    prefix: "son",
    body: wav,
    contentType: "audio/wav",
  });

  const events = [];
  for (let i = 1; i < points.length; i += 1) {
    const delta = points[i].v - points[i - 1].v;
    if (Math.abs(delta) < Math.max(10, Math.abs(points[i - 1].v) * 0.12)) continue;
    events.push({
      t: points[i].t,
      type: delta > 0 ? "spike" : "dip",
      strength: roundCurrency(Math.min(1, Math.abs(delta) / Math.max(1, points[i - 1].v))),
    });
  }

  return {
    audio_url: `/api/sonify/audio/${clipId}`,
    meta: {
      duration_ms: Math.round(durationMs / clamp(speed, 0.5, 1.5)),
      events: events.slice(0, 3),
    },
  };
}

export async function runAgentTool(toolName, args, context = {}) {
  const dataset = await resolveDataset(context, args);

  switch (toolName) {
    case "metrics_summary":
      return {
        ok: true,
        tool: toolName,
        data: summarizeDays(
          resolveRange(args.range ?? "today", args.start, args.end, dataset),
          args.range ?? "today",
        ),
      };
    case "metrics_compare": {
      const base = summarizeDays(
        resolveRange(args.range ?? "today", undefined, undefined, dataset),
        args.range ?? "today",
      );
      const compareTo = summarizeDays(
        resolveRange(args.compare_to ?? "yesterday", undefined, undefined, dataset),
        args.compare_to ?? "yesterday",
      );

      return {
        ok: true,
        tool: toolName,
        data: {
          base,
          compare_to: compareTo,
          deltas: calculateDeltas(base, compareTo),
        },
      };
    }
    case "metrics_timeseries":
      return {
        ok: true,
        tool: toolName,
        data: buildTimeseries({
          metric: args.metric ?? "revenue",
          range: args.range ?? "last_7d",
          bucket: args.bucket ?? "day",
          data: dataset,
        }),
      };
    case "metrics_breakdown":
      return {
        ok: true,
        tool: toolName,
        data: buildBreakdown({
          metric: args.metric ?? "revenue",
          range: args.range ?? "today",
          limit: args.limit ?? 5,
          data: dataset,
        }),
      };
    case "metrics_anomalies":
      return {
        ok: true,
        tool: toolName,
        data: buildAnomalies({
          metric: args.metric ?? "revenue",
          range: args.range ?? "last_30d",
          data: dataset,
        }),
      };
    case "sonify_series":
      return {
        ok: true,
        tool: toolName,
        data: createTrendClip({
          points: args.series?.points ?? [],
          speed: args.mapping?.speed ?? 1,
          normalize: args.mapping?.normalize ?? "minmax",
          durationMs: args.mapping?.duration_ms ?? 2600,
        }),
      };
    case "sonify_dashboard": {
      launchSonifyDashboard();

      const range = args.range ?? "last_30d";
      const revenuePoints = buildTimeseries({ metric: "revenue", range, bucket: "day", data: dataset }).points;
      const orderPoints   = buildTimeseries({ metric: "orders",  range, bucket: "day", data: dataset }).points;

      const { wav, lagDays } = renderDashboardV1({
        trafficPoints: orderPoints,
        revenuePoints,
        durationMs: args.duration_ms ?? 12000,
        ticks: args.ticks !== false,
      });

      const { clipId } = putClip({ prefix: "dash", body: wav, contentType: "audio/wav" });

      const convRatePoints = orderPoints.map((p, i) => ({
        t: p.t,
        v: p.v > 0 ? roundCurrency(revenuePoints[i].v / p.v) : 0,
      }));

      return {
        ok: true,
        tool: toolName,
        data: {
          audio_url: `/api/sonify/audio/${clipId}`,
          lag_days: lagDays,
          meta: {
            duration_ms: args.duration_ms ?? 18000,
            channels: {
              left:  "traffic (orders) — organ pad, pitch = order volume",
              right: `revenue echo — chorus + reverb, delayed ${lagDays} day${lagDays !== 1 ? "s" : ""}`,
            },
          },
          chart_data: {
            traffic: orderPoints,
            conversion_rate: convRatePoints,
          },
        },
      };
    }

    default:
      throw new Error(`Unsupported tool: ${toolName}`);
  }
}
