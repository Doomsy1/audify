import test from "node:test";
import assert from "node:assert/strict";

import { detectVoiceCapabilities } from "../featureDetection.js";

test("detectVoiceCapabilities reports speech support when SpeechRecognition exists", () => {
  const capabilities = detectVoiceCapabilities({
    SpeechRecognition: class SpeechRecognition {},
  });

  assert.equal(capabilities.speechRecognitionSupported, true);
  assert.equal(capabilities.fallbackToText, false);
});

test("detectVoiceCapabilities falls back to text when speech APIs are unavailable", () => {
  const capabilities = detectVoiceCapabilities({});

  assert.equal(capabilities.speechRecognitionSupported, false);
  assert.equal(capabilities.fallbackToText, true);
});
