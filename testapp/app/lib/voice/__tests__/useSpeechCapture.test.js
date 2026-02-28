import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMicrophoneAccessError,
  formatRecognitionError,
  shouldRestartRecognitionSession,
} from "../useSpeechCapture.js";

test("shouldRestartRecognitionSession restarts when press is still active and no final transcript exists", () => {
  assert.equal(
    shouldRestartRecognitionSession({
      isPressing: true,
      hasFinalTranscript: false,
      hasFatalError: false,
    }),
    true,
  );
});

test("shouldRestartRecognitionSession does not restart after a final transcript", () => {
  assert.equal(
    shouldRestartRecognitionSession({
      isPressing: true,
      hasFinalTranscript: true,
      hasFatalError: false,
    }),
    false,
  );
});

test("formatRecognitionError explains blocked microphone access", () => {
  assert.equal(
    formatRecognitionError("not-allowed"),
    "Microphone access was blocked. Allow microphone access for this site or use the text input fallback.",
  );
});

test("formatRecognitionError returns empty string for aborted sessions", () => {
  assert.equal(formatRecognitionError("aborted"), "");
});

test("buildMicrophoneAccessError explains embedded iframe blocking", () => {
  assert.equal(
    buildMicrophoneAccessError({
      errorName: "NotAllowedError",
      embeddedContext: true,
      secureContext: true,
    }),
    "Chrome is not prompting because this Shopify page is running inside an embedded iframe that blocks microphone access. Open the voice page in a new tab or use the text input fallback.",
  );
});
