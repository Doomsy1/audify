import { putClip } from "../audio/clipStore.server";
import { createToneWave } from "../audio/simpleWave.server";
import { clamp } from "../contracts/agent";

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

function resolveRange(range, start, end) {
  const data = getDataset();
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

function summarizeDays(days, range) {
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

function buildTimeseries({ metric, range, bucket }) {
  const days = resolveRange(range);
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

function buildBreakdown({ metric, range, limit = 5 }) {
  const days = resolveRange(range);
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

function buildAnomalies({ metric, range }) {
  const series = buildTimeseries({ metric, range, bucket: "day" }).points;
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

export async function runAgentTool(toolName, args) {
  switch (toolName) {
    case "metrics_summary":
      return {
        ok: true,
        tool: toolName,
        data: summarizeDays(
          resolveRange(args.range ?? "today", args.start, args.end),
          args.range ?? "today",
        ),
      };
    case "metrics_compare": {
      const base = summarizeDays(resolveRange(args.range ?? "today"), args.range ?? "today");
      const compareTo = summarizeDays(
        resolveRange(args.compare_to ?? "yesterday"),
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
        }),
      };
    case "metrics_anomalies":
      return {
        ok: true,
        tool: toolName,
        data: buildAnomalies({
          metric: args.metric ?? "revenue",
          range: args.range ?? "last_30d",
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
    default:
      throw new Error(`Unsupported tool: ${toolName}`);
  }
}
