# Member B Plan (Sonification Engine + Audio APIs)

## Goals

- Deliver the full metrics API surface plus the sonification API surface needed by the agent and UI.
- Reuse the existing prototype work in `testapp/app/routes/app.sonify.jsx` and `testapp/app/lib/sonification/audioEngine.js` so the new audio mappings sound consistent with the current demo.
- Make the demo work even if Shopify ingestion is incomplete by serving deterministic mock analytics data.
- Support one required preset and one optional preset:
  - `trend_v1` for a single time series
  - `compare_v1` for two ranges if time permits

Done means:

- `GET /api/metrics/summary`, `compare`, `timeseries`, and `breakdown` work.
- `POST /api/sonify/series` returns a playable WAV URL and metadata.
- `GET /api/sonify/audio/:clipId` serves the generated WAV from a server-side clip store.
- The sound mapping is learnable: higher pitch means higher value, and spike/dip markers are audible.

## Repo Integration Strategy

Quick repo-audit checklist to run before coding:

- Review `testapp/app/routes/app.sonify.jsx` for current audio vocabulary, timing controls, and synthetic data helpers.
- Review `testapp/app/lib/sonification/audioEngine.js` for chord, pitch, and event cue constants worth reusing.
- Review `testapp/app/routes/app.seed.jsx` to decide whether Shopify-seeded orders are useful or if a fully mocked repository is faster.
- Confirm `testapp/prisma/schema.prisma` only contains `Session`, so adding real metrics persistence is optional, not required for MVP.

Actual repo findings to build on:

- The prototype already has a browser-only AudioContext engine and a sonification demo page.
- There is no server-side metrics API yet.
- There is no server-side audio rendering pipeline yet.

Adaptation plan:

- Extract mapping constants and sonic cues from the current client prototype rather than inventing a new sound language.
- Preserve the current embedded-app route structure and add new API routes under `testapp/app/routes`.
- Start with deterministic mock data modules so Member A can consume stable JSON immediately.
- Use an in-memory clip store for WAV bytes first, because it is fast and keeps the server-only secret boundary simple.

## Concrete File/Folder Changes

Create:

- `testapp/app/routes/api.metrics.summary.jsx`
- `testapp/app/routes/api.metrics.compare.jsx`
- `testapp/app/routes/api.metrics.timeseries.jsx`
- `testapp/app/routes/api.metrics.breakdown.jsx`
- `testapp/app/routes/api.metrics.anomalies.jsx`
- `testapp/app/routes/api.sonify.series.jsx`
- `testapp/app/routes/api.sonify.compare.jsx`
- `testapp/app/routes/api.sonify.audio.$clipId.jsx`
- `testapp/app/lib/metrics/mockDataset.server.js`
- `testapp/app/lib/metrics/repository.server.js`
- `testapp/app/lib/metrics/query.server.js`
- `testapp/app/lib/metrics/ranges.server.js`
- `testapp/app/lib/metrics/anomalies.server.js`
- `testapp/app/lib/sonification/sharedMapping.js`
- `testapp/app/lib/sonification/presets/trendV1.server.js`
- `testapp/app/lib/sonification/presets/compareV1.server.js`
- `testapp/app/lib/sonification/wavEncoder.server.js`
- `testapp/app/lib/sonification/renderSeries.server.js`
- `testapp/app/lib/audio/clipStore.server.js`
- `testapp/app/lib/contracts/metrics.js`
- `testapp/app/lib/contracts/sonify.js`

Modify:

- `testapp/app/lib/sonification/audioEngine.js`
- Extract reusable constants to `sharedMapping.js` so client preview and server rendering stay aligned.
- `testapp/app/routes/app.sonify.jsx`
- Optional: repoint the existing demo page to the new server-side `POST /api/sonify/series` endpoint for parity checks.
- `testapp/prisma/schema.prisma`
- Optional future models: `Order`, `OrderItem`; do not block MVP on this.

## API Contracts

### Owned public endpoint: `GET /api/metrics/summary`

Request query:

- `range=today|yesterday|last_7d|last_30d|custom`
- `start` and `end` only when `range=custom`
- `tz=IANA timezone`

Response:

```json
{
  "range": "today",
  "start": "2026-02-28T00:00:00.000Z",
  "end": "2026-02-28T23:59:59.999Z",
  "revenue": 1234,
  "orders": 42,
  "aov": 29.39
}
```

### Owned public endpoint: `GET /api/metrics/compare`

Response:

```json
{
  "base": {
    "range": "today",
    "revenue": 1234,
    "orders": 42,
    "aov": 29.39
  },
  "compare_to": {
    "range": "yesterday",
    "revenue": 1100,
    "orders": 40,
    "aov": 27.5
  },
  "deltas": {
    "revenue_abs": 134,
    "revenue_pct": 12.18,
    "orders_abs": 2,
    "orders_pct": 5,
    "aov_abs": 1.89,
    "aov_pct": 6.87
  }
}
```

### Owned public endpoint: `GET /api/metrics/timeseries`

Response:

```json
{
  "metric": "revenue",
  "bucket": "day",
  "points": [
    {
      "t": "2026-02-22T00:00:00.000Z",
      "v": 120.5
    },
    {
      "t": "2026-02-23T00:00:00.000Z",
      "v": 98
    }
  ]
}
```

### Owned public endpoint: `GET /api/metrics/breakdown`

Response:

```json
{
  "metric": "revenue",
  "by": "product",
  "rows": [
    {
      "key": "Seed Product",
      "value": 540,
      "orders": 18
    }
  ]
}
```

### Owned public endpoint: `GET /api/metrics/anomalies`

Response:

```json
{
  "anomalies": [
    {
      "t": "2026-02-24T00:00:00.000Z",
      "v": 240,
      "expected": 140,
      "z": 2.7,
      "reason": "Revenue spike above rolling baseline"
    }
  ]
}
```

### Owned public endpoint: `POST /api/sonify/series`

Request:

```json
{
  "series": {
    "metric": "revenue",
    "bucket": "day",
    "points": [
      {
        "t": "2026-02-22T00:00:00.000Z",
        "v": 120.5
      }
    ]
  },
  "mapping": {
    "preset": "trend_v1",
    "duration_ms": 2800,
    "speed": 1,
    "normalize": "minmax",
    "range_hint": "last_7d"
  },
  "render": {
    "format": "wav",
    "sample_rate": 24000
  }
}
```

Response:

```json
{
  "audio_url": "/api/sonify/audio/son_123.wav",
  "meta": {
    "duration_ms": 2800,
    "events": [
      {
        "t": "2026-02-24T00:00:00.000Z",
        "type": "spike",
        "strength": 0.9
      }
    ]
  }
}
```

### Owned public endpoint: `POST /api/sonify/compare`

Request:

```json
{
  "a": {
    "label": "this_week",
    "points": [
      {
        "t": "2026-02-22T00:00:00.000Z",
        "v": 120.5
      }
    ]
  },
  "b": {
    "label": "last_week",
    "points": [
      {
        "t": "2026-02-15T00:00:00.000Z",
        "v": 100.1
      }
    ]
  },
  "mapping": {
    "preset": "compare_v1",
    "duration_ms": 3200
  }
}
```

Response:

```json
{
  "audio_url": "/api/sonify/audio/son_cmp_1.wav",
  "meta": {
    "duration_ms": 3200,
    "explain_hint": "First phrase is this week, second phrase is last week. Higher notes mean larger values."
  }
}
```

## Step-by-Step Implementation Tasks With Ordering

1. Freeze shared contracts.
- Add `contracts/metrics.js` and `contracts/sonify.js` with JSDoc shapes.
- Send the exact request/response payloads to Members A and C before implementation starts.

2. Build the mock metrics repository first.
- Create `mockDataset.server.js` with 30 days of deterministic orders, product mix, one obvious spike, and one dip.
- Include enough structure to answer all five demo queries without Shopify data.

3. Implement range and aggregation helpers.
- Add `ranges.server.js` to convert `range/start/end/tz` into UTC windows.
- Add `query.server.js` to compute summary, compare, timeseries, and breakdown results from the mock dataset.

4. Expose the metrics routes.
- Add `api.metrics.summary.jsx`, `compare.jsx`, `timeseries.jsx`, `breakdown.jsx`.
- Authenticate with `authenticate.admin(request)` for consistency with the rest of the app.

5. Add anomaly detection.
- Implement `anomalies.server.js` with a simple rolling mean + z-score rule.
- Expose `api.metrics.anomalies.jsx`.
- Keep it deterministic and explainable.

6. Extract shared sonification mapping.
- Move value-to-pitch ranges, spike tick assumptions, and any reusable timing constants out of `audioEngine.js` into `sharedMapping.js`.
- Do not break the existing `app.sonify.jsx` demo while doing this.

7. Implement server-side waveform rendering.
- Add `trendV1.server.js` that maps normalized points to pitch and amplitude envelopes.
- Add `wavEncoder.server.js` to emit PCM WAV at 24 kHz.
- Add `renderSeries.server.js` to build the audio buffer and event metadata.

8. Add the clip store and serving route.
- Reuse the same in-memory LRU pattern as `api.audio-plan.jsx`.
- Store WAV bytes in `clipStore.server.js`.
- Serve them via `api.sonify.audio.$clipId.jsx`.

9. Expose `POST /api/sonify/series`.
- Validate payload shape.
- Render WAV.
- Return `audio_url` and metadata.

10. Optional compare pass.
- Implement `compareV1.server.js` and `api.sonify.compare.jsx`.
- Only do this after `trend_v1` is solid.

11. Optional parity pass with the existing demo.
- Point `app.sonify.jsx` at the new server-rendered audio endpoint for a quick manual comparison.

## Unit/Integration Test Plan

Unit tests to add with Vitest:

- Range parsing returns the correct UTC bounds for `today`, `yesterday`, `last_7d`, and `custom`.
- Summary and compare calculations produce stable numeric output from the mock dataset.
- Timeseries bucketing yields deterministic `points[]`.
- Anomaly detection flags the seeded spike and does not over-fire on normal days.
- `trend_v1` mapping converts larger values into higher target frequencies.
- WAV encoder produces a valid RIFF/WAVE header and non-empty PCM payload.

Integration tests:

- `GET /api/metrics/summary` returns the exact top-level keys the spec requires.
- `GET /api/metrics/timeseries?metric=revenue&range=last_7d&bucket=day` returns seven points.
- `POST /api/sonify/series` returns `audio_url`, then `GET /api/sonify/audio/:clipId` returns `200` and `audio/wav`.
- `POST /api/sonify/series` with `normalize=zscore` makes spike metadata more pronounced for the seeded anomaly.

Manual acceptance checks:

- The returned 7-day revenue trend audibly rises and falls in the same places as the mock data.
- A spike day produces a distinct marker sound.
- The agent can consume these APIs unchanged.

## Local Run Instructions

From the repo root:

1. `cd /Users/scr4tch/Documents/Coding/Projects/audify/testapp`
2. Install deps:
   - `npm install`
   - or `pnpm install`
   - or `yarn`
3. If you add Prisma models, run:
   - `npm run setup`
4. Start the app:
   - `npm run dev`
5. Smoke test routes:
   - `GET /api/metrics/summary?range=today&tz=America/New_York`
   - `GET /api/metrics/timeseries?metric=revenue&range=last_7d&bucket=day&tz=America/New_York`
   - `POST /api/sonify/series`
   - `GET /api/sonify/audio/:clipId`

## Interfaces to Other Members

### What this member needs from Member A

- The exact tool wrapper names and the final shape the agent expects from each API.
- The default `sonify_speed` and `listen_mode` semantics to keep durations predictable.

Expected sonification call shape from Member A:

```json
{
  "series": {
    "metric": "revenue",
    "bucket": "day",
    "points": [
      {
        "t": "2026-02-22T00:00:00.000Z",
        "v": 120.5
      }
    ]
  },
  "mapping": {
    "preset": "trend_v1",
    "duration_ms": 2800,
    "speed": 0.75,
    "normalize": "minmax",
    "range_hint": "last_7d"
  },
  "render": {
    "format": "wav",
    "sample_rate": 24000
  }
}
```

### What this member needs from Member C

- Client playback expectations for sequencing and speed controls.
- Confirmation that plain `audio_url` playback is sufficient and no streaming transport is required for MVP.

Expected playback assumptions from Member C:

```json
{
  "autoplay_sequence": [
    "tts",
    "sonification"
  ],
  "allow_speed_control": true,
  "preferred_default_speed": 1
}
```

### What this member provides

- Stable metrics JSON for all summary/trend/breakdown data.
- Stable sonification clip URLs and metadata.

Guaranteed metrics JSON to Member A:

```json
{
  "range": "today",
  "start": "string",
  "end": "string",
  "revenue": 0,
  "orders": 0,
  "aov": 0
}
```

Guaranteed sonification JSON to Members A and C:

```json
{
  "audio_url": "/api/sonify/audio/son_123.wav",
  "meta": {
    "duration_ms": 2800,
    "events": [
      {
        "t": "string",
        "type": "spike",
        "strength": 0.9
      }
    ]
  }
}
```

## Risk List + Fallback Options to Keep Demoable

- Risk: Server-side WAV rendering takes longer than expected.
- Fallback: keep `trend_v1` to short, fixed-duration clips and defer `compare_v1`.

- Risk: Real Shopify data access is incomplete.
- Fallback: use the deterministic mock repository as the primary data source and clearly label it in development.

- Risk: The current browser AudioContext prototype and the server-rendered audio diverge.
- Fallback: share constants only and prioritize stable server-generated clips for the actual demo path.

- Risk: In-memory clip storage evicts clips too aggressively during demos.
- Fallback: increase the LRU size for local demo builds and keep clip durations short.

- Risk: Anomaly detection is noisy.
- Fallback: seed one explicit spike in the mock dataset and expose a deterministic anomaly list for MVP.

## Demo Script

1. Seed or load the built-in mock metrics dataset.
2. Call `GET /api/metrics/summary?range=today` and verify the numeric summary.
3. Call `GET /api/metrics/timeseries?metric=revenue&range=last_7d&bucket=day`.
4. Pass that series to `POST /api/sonify/series`.
5. Play the returned WAV and confirm the spike day is audible.
6. Hand the same route outputs to Member A and confirm the agent can narrate and attach the clip without contract changes.
