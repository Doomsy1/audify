/**
 * Metrics API contracts — shared JSDoc types for Member A (agent) and Member C (UI).
 *
 * All timestamps are ISO-8601 UTC strings.
 * All monetary values are in the store's default currency, rounded to 2 dp.
 */

/**
 * @typedef {'today'|'yesterday'|'last_7d'|'last_30d'|'custom'} RangePreset
 */

/**
 * Query params accepted by GET /api/metrics/summary
 * @typedef {object} SummaryQuery
 * @property {RangePreset} [range='last_30d']
 * @property {string}      [start]   ISO-8601, required when range='custom'
 * @property {string}      [end]     ISO-8601, required when range='custom'
 * @property {string}      [tz='UTC'] IANA timezone string
 */

/**
 * Response from GET /api/metrics/summary
 * @typedef {object} SummaryResponse
 * @property {RangePreset} range
 * @property {string}      start   UTC window start (ISO-8601)
 * @property {string}      end     UTC window end   (ISO-8601)
 * @property {number}      revenue Total revenue
 * @property {number}      orders  Order count
 * @property {number}      aov     Average order value
 */

/**
 * Response from GET /api/metrics/compare
 * @typedef {object} CompareResponse
 * @property {object} base
 * @property {RangePreset} base.range
 * @property {number}      base.revenue
 * @property {number}      base.orders
 * @property {number}      base.aov
 * @property {object} compare_to
 * @property {string}  compare_to.range
 * @property {number}  compare_to.revenue
 * @property {number}  compare_to.orders
 * @property {number}  compare_to.aov
 * @property {object} deltas
 * @property {number}  deltas.revenue_abs
 * @property {number}  deltas.revenue_pct
 * @property {number}  deltas.orders_abs
 * @property {number}  deltas.orders_pct
 * @property {number}  deltas.aov_abs
 * @property {number}  deltas.aov_pct
 */

/**
 * Single time-series data point
 * @typedef {object} TimeseriesPoint
 * @property {string} t  ISO-8601 timestamp (bucket start)
 * @property {number} v  Metric value
 */

/**
 * Response from GET /api/metrics/timeseries
 * @typedef {object} TimeseriesResponse
 * @property {'revenue'|'orders'|'aov'} metric
 * @property {'hour'|'day'|'week'}      bucket
 * @property {TimeseriesPoint[]}        points
 */

/**
 * Single breakdown row
 * @typedef {object} BreakdownRow
 * @property {string} key    Dimension value (e.g. product title)
 * @property {number} value  Metric total
 * @property {number} orders Order count
 */

/**
 * Response from GET /api/metrics/breakdown
 * @typedef {object} BreakdownResponse
 * @property {'revenue'|'orders'} metric
 * @property {'product'|'day'}    by
 * @property {BreakdownRow[]}     rows  Sorted by value desc
 */

/**
 * Single anomaly record
 * @typedef {object} AnomalyRecord
 * @property {string} t        ISO-8601 timestamp
 * @property {number} v        Observed value
 * @property {number} expected Rolling baseline
 * @property {number} z        Z-score
 * @property {string} reason   Human-readable explanation
 */

/**
 * Response from GET /api/metrics/anomalies
 * @typedef {object} AnomaliesResponse
 * @property {AnomalyRecord[]} anomalies
 */
