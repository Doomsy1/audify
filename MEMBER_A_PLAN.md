# Member A Plan (Agent + Backboard + Orchestration)

## Goals

- Deliver the end-to-end agent endpoint that turns a transcript into a short, spoken-friendly analytics answer plus optional sonification clips.
- Freeze the shared JSON contract on day 1 so Members B and C can build in parallel without waiting on implementation details.
- Reuse the existing Backboard integration pattern in `testapp/app/routes/api.audio-plan.jsx` and `testapp/app/lib/audioPlan/backboard.server.js` instead of creating a separate LLM stack.
- Keep all secrets server-side and proxy all Backboard and ElevenLabs requests through the app server.
- Support exactly five demo queries:
  - "How are we doing today?"
  - "Compare today to yesterday."
  - "Play the last 7 days of revenue."
  - "Play that trend again slower."
  - "What caused the spike?"

Done means:

- `POST /api/agent/respond` returns the final agent response schema from the spec.
- The endpoint can call only `metrics_*` and `sonify_*` tool adapters.
- The endpoint synthesizes TTS for `spoken` via ElevenLabs and returns a playable `tts` clip in `audio[]`.
- Agent memory persists at least for the current shop/session for `default_range`, `last_metric`, `tz`, `listen_mode`, `sonify_speed`, and `verbosity`.

## Repo Integration Strategy

Quick repo-audit checklist to run before coding:

- Confirm route auto-registration still uses `flatRoutes()` in `testapp/app/routes.js`.
- Confirm existing Backboard env vars are already wired in `testapp/app/lib/audioPlan/backboard.server.js`.
- Confirm `testapp/app/routes/api.audio-plan.jsx` still demonstrates auth, JSON parsing, and in-memory LRU cache patterns.
- Confirm `testapp/app/routes/app.sonify.jsx` is still the main reference for playback-state vocabulary and speed controls.
- Confirm Prisma only contains `Session` so any persistent agent memory migration is deliberate, not assumed.

Actual repo findings to build on:

- `testapp` is the real app root.
- Backboard call wiring already exists in `testapp/app/lib/audioPlan/backboard.server.js`.
- Route-level auth and server JSON response patterns already exist in `testapp/app/routes/api.audio-plan.jsx`.
- No metrics API or TTS proxy exists yet.

Adaptation plan:

- Copy the existing Backboard fetch/error handling style into a new agent module instead of rewriting from scratch.
- Reuse the current in-memory LRU approach first for clip metadata and session memory, then optionally add Prisma persistence after the vertical slice is working.
- Keep all new work inside `testapp/app/routes` and `testapp/app/lib` so the current React Router file routing and Shopify auth continue working unchanged.

## Concrete File/Folder Changes

Create:

- `testapp/app/routes/api.agent.respond.jsx`
- `testapp/app/routes/api.tts.audio.$clipId.jsx`
- `testapp/app/lib/agent/backboardAgent.server.js`
- `testapp/app/lib/agent/prompt.js`
- `testapp/app/lib/agent/toolRegistry.server.js`
- `testapp/app/lib/agent/orchestrator.server.js`
- `testapp/app/lib/agent/memory.server.js`
- `testapp/app/lib/tts/elevenlabs.server.js`
- `testapp/app/lib/audio/clipStore.server.js`
- `testapp/app/lib/contracts/agent.js`

Modify:

- `testapp/prisma/schema.prisma`
- Optional model: `VoiceAgentMemory` for persistence if in-memory storage proves too fragile for the demo.
- `testapp/app/routes/app.jsx`
- Add nav link for the new voice page once Member C lands `app.voice.jsx`.

Suggested module boundaries:

- `toolRegistry.server.js` exposes normalized wrappers for `metrics_summary`, `metrics_compare`, `metrics_timeseries`, `metrics_breakdown`, `metrics_anomalies`, `sonify_series`, `sonify_compare`.
- `orchestrator.server.js` handles intent classification, tool-call sequencing, memory read/write, and response shaping.
- `elevenlabs.server.js` handles TTS generation only and stores generated audio buffers in `clipStore.server.js`.

## API Contracts

### Owned public endpoint: `POST /api/agent/respond`

Request:

```json
{
  "utterance": "How are we doing today?",
  "context": {
    "tz": "America/New_York",
    "listen_mode": false,
    "client_request_id": "req_123",
    "session_id": "voice_session_1"
  },
  "overrides": {
    "range": "today",
    "metric": "revenue",
    "sonify_speed": 1,
    "verbosity": "short"
  }
}
```

Response:

```json
{
  "spoken": "Today revenue is $1,234 from 42 orders. That is up 12% from yesterday. I will play the last 7 days of revenue next. Higher notes mean higher revenue.",
  "display": {
    "bullets": [
      "Revenue: $1,234 (+12% vs yesterday)",
      "Orders: 42 (+5% vs yesterday)",
      "AOV: $29.39 (+6.9% vs yesterday)"
    ],
    "suggested_questions": [
      "Play that trend again slower",
      "What caused the spike?"
    ]
  },
  "audio": [
    {
      "type": "tts",
      "label": "Agent response",
      "audio_url": "/api/tts/audio/tts_abc123.mp3"
    },
    {
      "type": "sonification",
      "label": "Revenue trend (7d)",
      "audio_url": "/api/sonify/audio/son_123.wav"
    }
  ],
  "tool_trace": [
    {
      "tool": "metrics_compare",
      "args": {
        "range": "today",
        "compare_to": "yesterday",
        "tz": "America/New_York"
      },
      "status": "ok"
    },
    {
      "tool": "metrics_timeseries",
      "args": {
        "metric": "revenue",
        "range": "last_7d",
        "bucket": "day",
        "tz": "America/New_York"
      },
      "status": "ok"
    },
    {
      "tool": "sonify_series",
      "args": {
        "preset": "trend_v1",
        "duration_ms": 2800,
        "speed": 1
      },
      "status": "ok"
    }
  ]
}
```

Error response:

```json
{
  "ok": false,
  "error": "Unable to complete agent response",
  "code": "AGENT_TOOL_FAILURE"
}
```

### Owned internal contract: tool adapter result

Every tool wrapper should normalize to:

```json
{
  "ok": true,
  "tool": "metrics_summary",
  "data": {},
  "latency_ms": 84
}
```

### Owned public endpoint: `GET /api/tts/audio/:clipId`

- Returns `audio/mpeg`.
- Reads buffer from shared clip store by `clipId`.
- 404 if the clip is evicted from memory.

## Step-by-Step Implementation Tasks With Ordering

1. Freeze cross-team contracts.
- Add `testapp/app/lib/contracts/agent.js` with JSDoc-documented request/response shapes.
- Share the exact `POST /api/agent/respond` schema with Members B and C before writing orchestration logic.

2. Implement shared in-memory stores first.
- Add `clipStore.server.js` with TTL + LRU for TTS and metadata.
- Add `memory.server.js` with simple `Map<shopOrSessionId, MemoryState>`.
- Keep the API stable so persistence can swap later.

3. Build the ElevenLabs proxy.
- Add `elevenlabs.server.js` with `synthesizeSpeech({ text, voiceId, modelId })`.
- Return a `clipId` and store the MP3 bytes in `clipStore`.
- Do not expose ElevenLabs keys to the browser.

4. Build tool wrappers before the LLM prompt.
- Implement `toolRegistry.server.js` as HTTP-internal wrappers that call Member B routes or import Member B server helpers directly once available.
- Normalize errors so the agent sees one contract regardless of upstream source.

5. Implement intent routing for the five supported queries.
- Hard-code a lightweight intent parser first using keyword matching.
- Map each intent to a fixed tool plan.
- Use this deterministic layer as the demo-safe fallback even after Backboard is added.

6. Implement Backboard reasoning on top of the deterministic plan.
- Add `prompt.js` that constrains tool use and response shape.
- Add `backboardAgent.server.js` using the same request structure and env handling style as the existing `audioPlan/backboard.server.js`.
- Ask Backboard to choose between the allowed tools and shape concise narration.

7. Implement the orchestration layer.
- `orchestrator.server.js` should:
  - Load memory.
  - Merge client overrides.
  - Execute the tool plan.
  - Request TTS for the final `spoken`.
  - Write memory updates.
  - Return the final response payload.

8. Expose the route.
- Add `api.agent.respond.jsx` with Shopify auth, JSON parsing, validation, and error mapping.
- Add `api.tts.audio.$clipId.jsx` to serve generated TTS bytes.

9. Wire the nav seam.
- Update `app.jsx` to include the new voice route once Member C has landed it.

10. Optional persistence pass.
- If time remains, add Prisma `VoiceAgentMemory` and migrate from in-memory to DB-backed storage.

## Unit/Integration Test Plan

Unit tests to add with Vitest:

- Intent parser selects the correct intent for each of the five supported queries.
- Memory merge logic prefers explicit overrides over stored defaults.
- Tool registry normalizes Member B data into a stable shape.
- TTS proxy rejects empty text and surfaces provider errors cleanly.
- Response shaper always returns `spoken`, `display`, `audio`, and `tool_trace`.

Integration tests:

- `POST /api/agent/respond` with mocked tool adapters returns a complete response payload.
- `POST /api/agent/respond` for "Play that trend again slower" uses stored `last_metric` and reduced `sonify_speed`.
- `GET /api/tts/audio/:clipId` returns `200` and `audio/mpeg` for a stored clip.
- Backboard disabled or failing should still return a deterministic fallback response, not a 500.

Manual acceptance checks:

- Ask all five demo questions in sequence and confirm memory carries context between turns.
- Confirm `listen_mode=true` shortens spoken output but still returns sonification clips.

## Local Run Instructions

From the repo root:

1. `cd /Users/scr4tch/Documents/Coding/Projects/audify/testapp`
2. Install dependencies with your package manager:
   - `npm install`
   - or `pnpm install`
   - or `yarn`
3. Set env vars in the local app environment:
   - `BACKBOARD_API_URL`
   - `BACKBOARD_API_KEY`
   - `BACKBOARD_MODEL`
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID`
4. Run Prisma if you add persistence:
   - `npm run setup`
5. Start the app:
   - `npm run dev`
6. Smoke test:
   - `POST /api/agent/respond`
   - `GET /api/tts/audio/:clipId`

## Interfaces to Other Members

### What this member needs from Member B

- Stable metrics and sonification service contracts.
- Low-latency server helpers or routes that return consistent JSON.

Required JSON shapes from Member B:

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

```json
{
  "metric": "revenue",
  "bucket": "day",
  "points": [
    {
      "t": "2026-02-22T00:00:00.000Z",
      "v": 120.5
    }
  ]
}
```

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

### What this member needs from Member C

- Client request payload for `POST /api/agent/respond`.
- Session identifier strategy for carrying memory across turns.
- Confirmation of listen-mode UI semantics.

Expected request JSON from Member C:

```json
{
  "utterance": "Play that trend again slower",
  "context": {
    "tz": "America/Los_Angeles",
    "listen_mode": true,
    "client_request_id": "req_456",
    "session_id": "voice_session_1"
  },
  "overrides": {
    "sonify_speed": 0.75
  }
}
```

### What this member provides

- Final response payload for the UI.
- TTS clip URLs the client can enqueue without knowing provider details.

Guaranteed response JSON to Member C:

```json
{
  "spoken": "string",
  "display": {
    "bullets": ["string"],
    "suggested_questions": ["string"]
  },
  "audio": [
    {
      "type": "tts",
      "label": "string",
      "audio_url": "/api/tts/audio/tts_abc123.mp3"
    },
    {
      "type": "sonification",
      "label": "string",
      "audio_url": "/api/sonify/audio/son_123.wav"
    }
  ],
  "tool_trace": [
    {
      "tool": "string",
      "args": {},
      "status": "ok"
    }
  ]
}
```

## Risk List + Fallback Options to Keep Demoable

- Risk: Backboard latency or schema drift makes the response unstable.
- Fallback: keep deterministic intent-to-tool plans as the primary execution path and use Backboard only for phrasing.

- Risk: ElevenLabs adds noticeable delay.
- Fallback: return text immediately and stream or lazily fetch the TTS clip after the JSON response.

- Risk: Prisma migration adds friction during demo week.
- Fallback: keep memory in process keyed by `session_id` and accept reset-on-restart for MVP.

- Risk: Member B routes are not ready when orchestration starts.
- Fallback: stub the tool registry with local fixtures that match the final JSON contracts.

- Risk: Overly broad voice handling causes edge-case failures.
- Fallback: constrain the parser to the five supported queries and route unknown input to a concise help response.

## Demo Script

1. Open the embedded voice analytics page.
2. Press Talk and say, "How are we doing today?"
3. The agent responds with a short spoken summary, then queues a 7-day revenue sonification.
4. Ask, "Play that trend again slower." The agent reuses `last_metric` and lowers `sonify_speed`.
5. Toggle Listen Mode and ask, "What caused the spike?" The response becomes shorter, but still includes a targeted sonification and follow-up suggestion.
6. Ask, "Compare today to yesterday." The tool trace should show `metrics_compare`, and the response should remain under roughly 20 seconds of speech.
