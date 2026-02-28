import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAudioQueue,
  applyPlaybackRateToQueue,
} from "../usePlaybackQueue.js";

test("normalizeAudioQueue keeps tts before sonification regardless of input order", () => {
  const queue = normalizeAudioQueue([
    { type: "sonification", label: "Trend", audio_url: "/son.wav" },
    { type: "tts", label: "Summary", audio_url: "/tts.mp3" },
  ]);

  assert.equal(queue[0].type, "tts");
  assert.equal(queue[1].type, "sonification");
});

test("applyPlaybackRateToQueue updates every queue item", () => {
  const queue = normalizeAudioQueue([
    { type: "tts", label: "Summary", audio_url: "/tts.mp3" },
    { type: "sonification", label: "Trend", audio_url: "/son.wav" },
  ]);

  const updated = applyPlaybackRateToQueue(queue, 1.5);

  assert.deepEqual(
    updated.map((item) => item.playback_rate),
    [1.5, 1.5],
  );
});

test("normalizeAudioQueue clamps playback rate into supported range", () => {
  const tooSlow = normalizeAudioQueue(
    [{ type: "tts", label: "Summary", audio_url: "/tts.mp3" }],
    0.1,
  );
  const tooFast = normalizeAudioQueue(
    [{ type: "tts", label: "Summary", audio_url: "/tts.mp3" }],
    3,
  );

  assert.equal(tooSlow[0].playback_rate, 0.5);
  assert.equal(tooFast[0].playback_rate, 2);
});

test("applyPlaybackRateToQueue clamps invalid values to defaults", () => {
  const queue = normalizeAudioQueue([
    { type: "tts", label: "Summary", audio_url: "/tts.mp3" },
  ]);

  const updated = applyPlaybackRateToQueue(queue, Number.NaN);

  assert.equal(updated[0].playback_rate, 1);
});
