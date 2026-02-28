# Combined Spec: Voice Agent + Sonified Analytics for Non-Visual Understanding

## 0) One-sentence product

A **voice-first Shopify analytics assistant** that answers questions *and* produces **audio representations of metrics** (“sonifications”) so a merchant can independently perceive trends/anomalies without charts.

---

## 1) Core UX (what the user experiences)

### Primary loop (Talk + Listen)

1. User presses **Talk**
2. Asks a question (“How are we doing today?”)
3. Agent responds with:

   * **Spoken explanation** (numbers + interpretation)
   * **Optional sonification clip(s)** that *encode the same data*
4. User can say:

   * “Play the trend again slower”
   * “Sonify revenue vs orders together”
   * “What did that spike correspond to?”

### Two modes

* **Explain Mode (default):** agent speaks + optionally appends sonification
* **Listen Mode:** minimal speech; mostly sonification + short cues (“spike on Feb 24”)

### Accessibility “killer features”

* “Daily audio briefing” (summary + short trend sound)
* “Anomaly listen” (play last 30 days where anomalies pop out)
* “Compare two sounds” (A/B sonification for two ranges)

---

## 2) Architecture (high-level)

**Web Client**

* mic capture / transcript display
* audio playback (agent TTS + sonification clips)
* “Listen mode” toggles, speed/repeat controls

**Backend (your server)**

* Metrics API (summary/timeseries/breakdown/anomalies)
* Sonification API (generate audio from numeric series)
* Agent router (Backboard tools)
* ElevenLabs proxy for TTS (and optional STT)

**Backboard Assistant**

* reasoning + memory + tool calling
* decides when to attach sonification + how to describe it

**ElevenLabs**

* TTS for the agent’s spoken response (streaming preferred)

---

## 3) Data model (MVP)

Minimal storage is fine (real Shopify ingestion later).

* `orders(id, created_at, total_price, currency)`
* `order_items(order_id, product_id, product_title, quantity, price)`

Optional later:

* sessions/visits (for conversion), refunds, ads channels.

---

## 4) “Tool Surface Area” (what the agent is allowed to call)

### Metrics API (same as before)

* `GET /api/metrics/summary?range=...`
* `GET /api/metrics/compare?range=...&compare_to=...`
* `GET /api/metrics/timeseries?metric=...&range=...&bucket=...`
* `GET /api/metrics/breakdown?metric=...&by=...&range=...&limit=...`
* `GET /api/metrics/anomalies?metric=...&range=...&bucket=...` (optional)

### Sonification API (new core)

**A) Generate a sonification from a time series**
`POST /api/sonify/series`

Request:

```json
{
  "series": {
    "metric": "revenue",
    "bucket": "day",
    "points": [{"t":"2026-02-22","v":120.5},{"t":"2026-02-23","v":98.0}]
  },
  "mapping": {
    "preset": "trend_v1",
    "duration_ms": 2500,
    "speed": 1.0,
    "normalize": "zscore",
    "range_hint": "last_7d"
  },
  "render": { "format": "wav", "sample_rate": 24000 }
}
```

Response:

```json
{
  "audio_url": "/api/sonify/audio/abc123.wav",
  "meta": {
    "duration_ms": 2500,
    "events": [
      {"t":"2026-02-23","type":"dip","strength":0.7}
    ]
  }
}
```

**B) Generate a comparative sonification (A vs B)**
`POST /api/sonify/compare`

Request:

```json
{
  "a": { "label":"this_week", "points":[...] },
  "b": { "label":"last_week", "points":[...] },
  "mapping": { "preset":"compare_v1", "duration_ms": 3000 }
}
```

Response:

```json
{
  "audio_url": "/api/sonify/audio/cmp789.wav",
  "meta": { "explain_hint": "A is brighter/higher than B when larger" }
}
```

**C) “Anomaly listen”**
`POST /api/sonify/anomalies`

* Input: timeseries + anomaly list
* Output: sonification where anomalies get a distinct “earcon” (audio marker)

---

## 5) Sonification design (MVP presets)

### Goals

* Make **shape** (up/down, volatility, spikes) perceptible quickly
* Be consistent so merchants learn it like a “sound legend”
* Avoid needing musical expertise

### Preset: `trend_v1` (single metric)

* **Pitch** encodes value (higher value → higher pitch)
* **Loudness** lightly encodes value change magnitude (bigger change → louder)
* **Time** maps to time buckets uniformly (e.g., 7 days → 2.5s)
* **Earcons**:

  * spike: short “tick”
  * dip: short “thud”
  * anomaly: distinct “chime” overlay

Normalization options:

* `minmax` (good for “shape only”)
* `zscore` (good for “outliers pop out”)
* `none` (raw scale; rarely good)

### Preset: `compare_v1` (two ranges)

* A plays in first half, B plays in second half (or call-and-response)
* Add a brief spoken cue: “First is this week, second is last week.”
* (Optional later) stereo split (A left, B right)

### Preset: `multitrack_v1` (two metrics)

* Revenue → pitch
* Orders → percussion density (more orders → denser clicks)
* Keep it subtle so it’s not noisy

---

## 6) Backboard Assistant spec (combined reasoning + sonification)

### Persona & rules

* Voice-first, non-visual analytics assistant
* Always:

  * lead with numbers
  * keep spoken responses short (<= 15–25s default)
  * attach sonification when it improves independent understanding:

    * trends, comparisons, volatility, anomalies
  * describe *how to listen*: “Higher notes mean higher revenue.”

### Output schema from agent

```json
{
  "spoken": "Today: $1,234 revenue from 42 orders. That's up 12% from yesterday. I'll play a 7-day revenue trend—higher notes mean higher revenue, and the chime marks an anomaly.",
  "display": {
    "bullets": [
      "Revenue: $1,234 (+12% vs yesterday)",
      "Orders: 42 (+5%)",
      "AOV: $29.39 (+6.9%)"
    ],
    "suggested_questions": [
      "Want top products for the dip day?",
      "Play revenue vs orders together?"
    ]
  },
  "audio": [
    {
      "type": "sonification",
      "label": "Revenue trend (7d)",
      "audio_url": "/api/sonify/audio/abc123.wav"
    },
    {
      "type": "tts",
      "label": "Agent response",
      "audio_url": "/api/tts/audio/tts555.mp3"
    }
  ],
  "tool_trace": [
    {"tool":"metrics_compare","args":{"range":"today","compare_to":"yesterday"}},
    {"tool":"metrics_timeseries","args":{"metric":"revenue","range":"last_7d","bucket":"day"}},
    {"tool":"sonify_series","args":{"preset":"trend_v1","duration_ms":2500}}
  ]
}
```

### Memory keys

* `default_range`, `default_bucket`, `last_metric`
* `listen_mode` (bool)
* `sonify_default` (always/sometimes/never)
* `sonify_speed` (0.75/1.0/1.25)
* `tz`, `store_id/shop_domain`

---

## 7) ElevenLabs integration spec

### TTS

* Input: `spoken`
* Output: streamed audio to client
* Voice: pick one consistent voice for demo

### STT (choose one)

* MVP fastest: browser Web Speech → text to backend
* Better: ElevenLabs STT for consistent quality

---

## 8) Client UI spec (minimal but strong)

### Layout

* Big **Talk** button
* Transcript panel (what user said)
* Response panel (bullets + suggested questions)
* Audio controls:

  * Play/Pause
  * Repeat
  * Speed (0.75x / 1x / 1.25x)
  * Toggle: “Listen mode”

### Playback sequence

Default:

1. Play agent TTS
2. Immediately play sonification clip(s)
3. Allow user to replay sonification alone (“Play the sound again”)

---

## 9) Implementation plan (fast path)

### Phase 1: Metrics endpoints (half day)

Implement `summary`, `compare`, `timeseries`, `breakdown`.
Use mock data if needed to unblock agent.

### Phase 2: Sonification service (half day)

Implement `sonify/series` with `trend_v1`:

* normalize
* map to pitch over time
* render WAV
* return `audio_url`

(You can implement rendering via a simple audio synthesis library or generate PCM manually—keep it deterministic.)

### Phase 3: Backboard agent + tools (half day)

* Tool routing: metrics + sonify
* Response schema + “when to sonify” rules

### Phase 4: ElevenLabs TTS + UI loop (half day)

* Push-to-talk → transcript
* Call backend → get response + audio urls
* Play TTS then sonification

### Phase 5: Demo polish (half day)

* Daily briefing
* Anomaly earcon (optional)
* Tight scripted flow

---

## 10) Demo script (90 seconds)

1. “Give me today’s summary.”
2. “Compare to yesterday.”
3. “Play the 7-day revenue trend sound.”
4. “Where was the anomaly?”
5. “Break down that day by top products.”
6. “Play revenue vs orders together.”

---