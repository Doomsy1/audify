import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVoiceRequestPayload,
  formatVoiceRequestError,
  voiceSessionReducer,
  initialVoiceSessionState,
} from "../useVoiceSession.js";

test("buildVoiceRequestPayload includes listen mode and speed overrides", () => {
  const payload = buildVoiceRequestPayload({
    utterance: "How are we doing today?",
    listenMode: true,
    sessionId: "voice_session_1",
    playbackRate: 0.75,
    timezone: "America/New_York",
    requestId: "req_123",
  });

  assert.deepEqual(payload, {
    utterance: "How are we doing today?",
    context: {
      tz: "America/New_York",
      listen_mode: true,
      client_request_id: "req_123",
      session_id: "voice_session_1",
    },
    overrides: {
      sonify_speed: 0.75,
    },
  });
});

test("voiceSessionReducer resets loading and stores error on request failure", () => {
  const loadingState = voiceSessionReducer(initialVoiceSessionState, {
    type: "request:start",
    transcript: "What caused the spike?",
    source: "speech",
  });

  const errorState = voiceSessionReducer(loadingState, {
    type: "request:error",
    error: "Network failed",
  });

  assert.equal(errorState.isLoading, false);
  assert.equal(errorState.error, "Network failed");
});

test("formatVoiceRequestError returns friendly message for html responses", () => {
  const message = formatVoiceRequestError({
    status: 404,
    contentType: "text/html; charset=utf-8",
    bodyText: "<!DOCTYPE html><html><body>Not found</body></html>",
  });

  assert.equal(
    message,
    "Voice endpoint returned HTML (404). Verify /api/agent/respond exists and returns JSON.",
  );
});
