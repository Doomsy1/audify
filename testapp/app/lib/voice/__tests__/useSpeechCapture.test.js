import test from "node:test";
import assert from "node:assert/strict";

import { shouldRestartRecognitionSession } from "../useSpeechCapture.js";

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
