/**
 * Date-range helpers — converts range/start/end/tz query params into UTC Date windows.
 *
 * MVP note: full IANA timezone support requires a tz library.  For now we handle
 * the most common case (UTC) correctly and accept other strings as best-effort
 * offsets via the browser/Node Date engine.  Swap in `date-fns-tz` later if needed.
 */

/** @param {Date} d */
function startOfDayUTC(d) {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/** @param {Date} d */
function endOfDayUTC(d) {
  const out = new Date(d);
  out.setUTCHours(23, 59, 59, 999);
  return out;
}

/**
 * Parse a range preset + optional custom bounds into { start: Date, end: Date }.
 *
 * @param {object} opts
 * @param {'today'|'yesterday'|'last_7d'|'last_30d'|'custom'} [opts.range='last_30d']
 * @param {string} [opts.start]  ISO-8601 (required for range='custom')
 * @param {string} [opts.end]    ISO-8601 (required for range='custom')
 * @param {string} [opts.tz]     IANA timezone string (best-effort)
 * @returns {{ start: Date, end: Date }}
 */
export function parseRange({ range = "last_30d", start, end } = {}) {
  const now = new Date();

  switch (range) {
    case "today":
      return { start: startOfDayUTC(now), end: endOfDayUTC(now) };

    case "yesterday": {
      const yd = new Date(now);
      yd.setUTCDate(yd.getUTCDate() - 1);
      return { start: startOfDayUTC(yd), end: endOfDayUTC(yd) };
    }

    case "last_7d": {
      const s = new Date(now);
      s.setUTCDate(s.getUTCDate() - 7);
      return { start: startOfDayUTC(s), end: endOfDayUTC(now) };
    }

    case "last_30d": {
      const s = new Date(now);
      s.setUTCDate(s.getUTCDate() - 30);
      return { start: startOfDayUTC(s), end: endOfDayUTC(now) };
    }

    case "custom": {
      if (!start || !end) {
        throw new Error("range=custom requires start and end query params (ISO-8601)");
      }
      const s = new Date(start);
      const e = new Date(end);
      if (isNaN(s) || isNaN(e)) throw new Error("Invalid start or end date");
      if (s > e) throw new Error("start must be before end");
      return { start: s, end: e };
    }

    default:
      throw new Error(`Unknown range preset: "${range}". Use today|yesterday|last_7d|last_30d|custom`);
  }
}

/**
 * Given a window { start, end }, compute the immediately preceding window of the same duration.
 * Useful for "vs previous period" comparisons.
 *
 * @param {{ start: Date, end: Date }} window
 * @returns {{ start: Date, end: Date }}
 */
export function previousPeriod({ start, end }) {
  const duration = end.getTime() - start.getTime();
  const prevEnd   = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - duration);
  return { start: prevStart, end: prevEnd };
}
