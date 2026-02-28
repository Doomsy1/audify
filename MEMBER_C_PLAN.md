# Member C Plan (Web Client Voice UX + Playback)

## Goals

- Deliver the embedded, voice-first client experience for merchants: push-to-talk, transcript, concise response text, and sequenced audio playback.
- Reuse existing prototype audio interaction patterns from `testapp/app/routes/app.sonify.jsx` wherever possible so playback controls feel familiar.
- Keep the UI scoped to a single accessible voice workflow, not a dashboard.
- Make the vertical slice usable even if browser speech recognition is unavailable.

Done means:

- There is a new embedded route for the voice experience.
- A merchant can press Talk, ask one of the five supported questions, see the transcript, and hear TTS followed by sonification.
- Listen Mode can reduce speech and bias toward sound.
- Playback controls support replay and speed changes without exposing secrets client-side.

## Repo Integration Strategy

Quick repo-audit checklist to run before coding:

- Review `testapp/app/routes/app.sonify.jsx` for existing play/stop, status labels, and speed control patterns.
- Review `testapp/app/routes/app.jsx` to add the new nav link without disturbing current embedded app structure.
- Review the template-heavy `testapp/app/routes/app._index.jsx` and decide whether to leave it alone or link to the new voice page.
- Confirm no existing microphone capture or speech recognition layer exists, so this track can own the first implementation.

Actual repo findings to build on:

- The current app already has an embedded nav and a standalone sonification demo page.
- The current sonification page already manages audio state and transport labels.
- There is no current voice route, transcript UI, or push-to-talk feature.

Adaptation plan:

- Reuse the transport vocabulary and status states from `app.sonify.jsx` for consistency.
- Keep the UI in the existing embedded app shell instead of introducing a separate frontend stack.
- Default to browser Web Speech API for speed, and fall back to typed input plus submit for unsupported browsers.
- Consume only Member A JSON endpoints and Member B audio URLs; do not talk directly to Backboard or ElevenLabs from the browser.

## Concrete File/Folder Changes

Create:

- `testapp/app/routes/app.voice.jsx`
- `testapp/app/components/voice/PushToTalkButton.jsx`
- `testapp/app/components/voice/TranscriptPanel.jsx`
- `testapp/app/components/voice/AgentResponsePanel.jsx`
- `testapp/app/components/voice/PlaybackQueue.jsx`
- `testapp/app/components/voice/ListenModeToggle.jsx`
- `testapp/app/components/voice/SuggestedQuestions.jsx`
- `testapp/app/lib/voice/useSpeechCapture.js`
- `testapp/app/lib/voice/usePlaybackQueue.js`
- `testapp/app/lib/voice/useVoiceSession.js`
- `testapp/app/lib/voice/featureDetection.js`
- `testapp/app/lib/contracts/clientVoice.js`

Modify:

- `testapp/app/routes/app.jsx`
- Add nav link: `Voice Analytics`.
- `testapp/app/routes/app._index.jsx`
- Optional: replace template CTA with a link to `/app/voice`.
- Optional shared extract from `testapp/app/routes/app.sonify.jsx`
- If helpful, move tiny transport/status helpers into `app/components/audio` for reuse.

## API Contracts

### Owned client request to Member A: `POST /api/agent/respond`

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
    "sonify_speed": 1
  }
}
```

Expected response:

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
      "args": {},
      "status": "ok"
    }
  ]
}
```

### Owned client-side playback queue model

Normalized queue item:

```json
{
  "id": "clip_1",
  "type": "tts",
  "label": "Agent response",
  "audio_url": "/api/tts/audio/tts_abc123.mp3",
  "playback_rate": 1,
  "status": "queued"
}
```

### Owned local transcript model

```json
{
  "request_id": "req_123",
  "source": "speech",
  "transcript": "How are we doing today?",
  "final": true,
  "created_at": "2026-02-28T15:00:00.000Z"
}
```

## Step-by-Step Implementation Tasks With Ordering

1. Freeze UI-to-server contracts.
- Add `clientVoice.js` documenting the request and response shapes.
- Align `session_id`, `listen_mode`, and `sonify_speed` fields with Member A before coding the page.

2. Build the voice session state hook.
- Add `useVoiceSession.js` to manage:
  - current transcript
  - request state
  - latest response payload
  - listen mode
  - playback speed
  - session id

3. Implement browser capability detection.
- Add `featureDetection.js` to detect:
  - `window.SpeechRecognition` or `window.webkitSpeechRecognition`
  - audio autoplay constraints
- If unsupported, show a text input fallback and keep the same submit path.

4. Implement speech capture.
- Add `useSpeechCapture.js` with a push-to-talk lifecycle:
  - start recognition on press
  - stop on release
  - return interim transcript for display
  - return final transcript for submit
- Keep the hook isolated so ElevenLabs STT can replace it later if needed.

5. Build the playback queue.
- Add `usePlaybackQueue.js` to:
  - accept `audio[]` from Member A
  - enqueue in order: `tts` first, then `sonification`
  - support replay
  - support global playback-rate changes
- Use native `<audio>` elements for MVP, not the Web Audio API.

6. Build the UI components.
- `PushToTalkButton.jsx`
- Press/hold interaction, status text, and fallback submit.
- `TranscriptPanel.jsx`
- Show interim and final transcript.
- `AgentResponsePanel.jsx`
- Render `spoken` and `display.bullets`.
- `SuggestedQuestions.jsx`
- Clicking a suggestion should submit it as the next utterance.
- `PlaybackQueue.jsx`
- Show clip labels, active clip, replay, and speed control.
- `ListenModeToggle.jsx`
- Toggle `listen_mode` and visually explain that responses become shorter.

7. Build the route.
- Add `app.voice.jsx` as the orchestration shell for all hooks/components.
- Keep layout simple, mobile-safe, and embedded-app friendly.

8. Wire the nav.
- Update `app.jsx` so merchants can reach `/app/voice`.
- Optionally add a shortcut CTA on `app._index.jsx`.

9. Accessibility pass.
- Ensure keyboard activation for push-to-talk fallback button.
- Add visible status text for recording, sending, and playback.
- Ensure transcripts and response text remain readable without audio.

10. Manual end-to-end pass.
- Verify the five supported demo questions complete without page refresh.

## Unit/Integration Test Plan

Unit tests to add with Vitest:

- `featureDetection` correctly reports browser support and fallback mode.
- `usePlaybackQueue` preserves clip order as `tts` then `sonification`.
- `usePlaybackQueue` updates all queued items when playback speed changes.
- `useVoiceSession` resets loading state on request failure.
- Clicking a suggested question reuses the same request pipeline as microphone input.

Integration tests:

- Render `app.voice.jsx`, submit a text fallback utterance, and verify the page shows transcript plus response text.
- Mock `POST /api/agent/respond` and verify the queue receives the returned `audio[]`.
- Toggle Listen Mode and verify the next request sends `"listen_mode": true`.
- Replay the returned queue and confirm the first clip is the TTS URL.

Manual acceptance checks:

- In a supported browser, press Talk, speak, release, and observe the transcript fills in before the request is sent.
- In an unsupported browser, type the same query and get the same result.
- Changing speed before replay affects both TTS and sonification playback.

## Local Run Instructions

From the repo root:

1. `cd /Users/scr4tch/Documents/Coding/Projects/audify/testapp`
2. Install deps:
   - `npm install`
   - or `pnpm install`
   - or `yarn`
3. Start the app:
   - `npm run dev`
4. Open the embedded app and navigate to `/app/voice`.
5. Test both paths:
   - Browser speech recognition path
   - Typed input fallback path
6. Verify playback by submitting a stubbed or real `POST /api/agent/respond` response.

## Interfaces to Other Members

### What this member needs from Member A

- A stable `POST /api/agent/respond` contract.
- TTS clip URLs that can be played directly by the browser.
- Memory keyed by `session_id` so follow-up questions behave naturally.

Required response JSON from Member A:

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

### What this member needs from Member B

- Sonification URLs must be plain browser-playable audio responses.
- Clip durations should stay short enough for queued playback to feel responsive.

Required sonification response JSON from Member B:

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

### What this member provides

- The browser-side request shape that exercises the agent.
- UX semantics for listen mode, replay, and speed control.

Guaranteed request JSON to Member A:

```json
{
  "utterance": "string",
  "context": {
    "tz": "string",
    "listen_mode": false,
    "client_request_id": "string",
    "session_id": "string"
  },
  "overrides": {
    "sonify_speed": 1
  }
}
```

Guaranteed playback assumptions to Member B:

```json
{
  "autoplay_sequence": [
    "tts",
    "sonification"
  ],
  "allow_speed_control": true,
  "max_preferred_total_duration_ms": 12000
}
```

## Risk List + Fallback Options to Keep Demoable

- Risk: Browser speech recognition is unavailable or inconsistent.
- Fallback: provide a first-class text input fallback that hits the same endpoint.

- Risk: Autoplay policies block chained playback.
- Fallback: start playback only after an explicit user gesture, then keep replay controls visible.

- Risk: Too much UI state makes the experience feel slow.
- Fallback: keep one active transcript, one active response, and one linear playback queue.

- Risk: The audio queue is confusing if too many clips are returned.
- Fallback: render and autoplay only the first TTS clip plus the first sonification clip in MVP, while listing any extras for manual replay.

- Risk: Embedded app styling fights the template UI.
- Fallback: keep the page simple, use the existing shell, and avoid introducing a new design system dependency.

## Demo Script

1. Open `/app/voice` inside the embedded app.
2. Press Talk and say, "How are we doing today?"
3. Read the transcript panel while the request is sent.
4. Hear the TTS answer first, then the sonification clip automatically.
5. Click "Play that trend again slower" from suggested questions and confirm replay at the lower speed.
6. Toggle Listen Mode and ask, "What caused the spike?" Confirm the response is shorter, still intelligible, and still playable without looking at a chart.
