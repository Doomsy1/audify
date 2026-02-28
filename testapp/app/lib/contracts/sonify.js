/**
 * Sonification API contracts — shared JSDoc types for Member A (agent) and Member C (UI).
 */

/**
 * @typedef {'trend_v1'|'compare_v1'} SonifyPreset
 */

/**
 * @typedef {'minmax'|'zscore'} NormalizeMethod
 */

/**
 * Single data point in a series (matches timeseries API output)
 * @typedef {object} SeriesPoint
 * @property {string} t  ISO-8601 timestamp
 * @property {number} v  Metric value
 */

/**
 * Series descriptor for POST /api/sonify/series
 * @typedef {object} SeriesDescriptor
 * @property {'revenue'|'orders'|'aov'} metric
 * @property {'hour'|'day'|'week'}      bucket
 * @property {SeriesPoint[]}            points
 */

/**
 * Mapping options for POST /api/sonify/series
 * @typedef {object} MappingOptions
 * @property {SonifyPreset}    [preset='trend_v1']
 * @property {number}          [duration_ms=2800]   Total audio duration
 * @property {number}          [speed=1]            Playback speed multiplier
 * @property {NormalizeMethod} [normalize='minmax'] Value normalisation method
 * @property {string}          [range_hint]         Original range label for metadata
 */

/**
 * Render options for POST /api/sonify/series
 * @typedef {object} RenderOptions
 * @property {'wav'}   [format='wav']
 * @property {number}  [sample_rate=24000]
 */

/**
 * Request body for POST /api/sonify/series
 * @typedef {object} SonifySeriesRequest
 * @property {SeriesDescriptor} series
 * @property {MappingOptions}   [mapping]
 * @property {RenderOptions}    [render]
 */

/**
 * Event marker within a generated clip
 * @typedef {object} SonifyEvent
 * @property {string}           t         ISO-8601 timestamp of source data point
 * @property {'spike'|'dip'}    type
 * @property {number}           strength  0..1
 */

/**
 * Response from POST /api/sonify/series
 * @typedef {object} SonifySeriesResponse
 * @property {string}        audio_url   Absolute path: /api/sonify/audio/<clipId>.wav
 * @property {object}        meta
 * @property {number}        meta.duration_ms
 * @property {SonifyEvent[]} meta.events
 */

/**
 * Series A or B descriptor for POST /api/sonify/compare
 * @typedef {object} CompareSeries
 * @property {string}        label   e.g. "this_week"
 * @property {SeriesPoint[]} points
 */

/**
 * Request body for POST /api/sonify/compare
 * @typedef {object} SonifyCompareRequest
 * @property {CompareSeries} a
 * @property {CompareSeries} b
 * @property {MappingOptions} [mapping]
 */

/**
 * Response from POST /api/sonify/compare
 * @typedef {object} SonifyCompareResponse
 * @property {string} audio_url
 * @property {object} meta
 * @property {number} meta.duration_ms
 * @property {string} meta.explain_hint
 */
