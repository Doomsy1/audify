/**
 * Anomaly detection — rolling mean + z-score rule.
 *
 * Algorithm:
 *  For each point i ≥ windowDays, compute:
 *    mean  = average of points[i-windowDays .. i-1]
 *    sigma = stddev of that window  (floored at 1 to avoid div-by-zero)
 *    z     = (points[i].v - mean) / sigma
 *  Flag the point if |z| ≥ zThreshold.
 *
 * The seeded mock dataset contains one clear spike (days 9–10) that reliably
 * fires with default params (windowDays=7, zThreshold=2.0).
 */

import { queryTimeseries } from "./query.server.js";

/**
 * @param {object} opts
 * @param {'revenue'|'orders'|'aov'} [opts.metric='revenue']
 * @param {string}  [opts.range='last_30d']
 * @param {string}  [opts.start]
 * @param {string}  [opts.end]
 * @param {string}  [opts.tz]
 * @param {number}  [opts.windowDays=7]   Rolling baseline window
 * @param {number}  [opts.zThreshold=2.0] Flag threshold
 * @returns {import('../contracts/metrics.js').AnomaliesResponse}
 */
export function detectAnomalies({
  metric      = "revenue",
  range       = "last_30d",
  start,
  end,
  tz,
  windowDays  = 7,
  zThreshold  = 2.0,
} = {}) {
  const { points } = queryTimeseries({ metric, bucket: "day", range, start, end, tz });

  if (points.length < windowDays + 1) {
    return { anomalies: [] };
  }

  const anomalies = [];

  for (let i = windowDays; i < points.length; i++) {
    const window = points.slice(i - windowDays, i).map((p) => p.v);
    const mean   = window.reduce((s, v) => s + v, 0) / window.length;
    const sigma  = Math.sqrt(
      window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length,
    ) || 1;

    const z = (points[i].v - mean) / sigma;

    if (Math.abs(z) >= zThreshold) {
      anomalies.push({
        t:        points[i].t,
        v:        points[i].v,
        expected: Math.round(mean * 100) / 100,
        z:        Math.round(z * 100) / 100,
        reason:
          z > 0
            ? `${metric} spike above ${windowDays}-day rolling baseline`
            : `${metric} dip below ${windowDays}-day rolling baseline`,
      });
    }
  }

  return { anomalies };
}
