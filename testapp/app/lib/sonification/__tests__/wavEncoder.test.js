import test from "node:test";
import assert from "node:assert/strict";

import { encodeWav } from "../wavEncoder.server.js";

const HEADER_SIZE = 44;

// ── RIFF/WAVE header structure ────────────────────────────────────────────────

test("encodeWav returns a Buffer", () => {
  const buf = encodeWav([0]);
  assert.ok(Buffer.isBuffer(buf));
});

test("encodeWav total size is 44 header bytes + 2 bytes per sample (int16)", () => {
  const samples = [0, 0.5, -0.5, 1, -1];
  const buf = encodeWav(samples, 24000, 1);
  assert.equal(buf.length, HEADER_SIZE + samples.length * 2);
});

test("encodeWav starts with 'RIFF' at offset 0", () => {
  const buf = encodeWav([0], 24000);
  assert.equal(buf.toString("ascii", 0, 4), "RIFF");
});

test("encodeWav has 'WAVE' at offset 8", () => {
  const buf = encodeWav([0], 24000);
  assert.equal(buf.toString("ascii", 8, 12), "WAVE");
});

test("encodeWav has 'fmt ' at offset 12", () => {
  const buf = encodeWav([0], 24000);
  assert.equal(buf.toString("ascii", 12, 16), "fmt ");
});

test("encodeWav has 'data' at offset 36", () => {
  const buf = encodeWav([0], 24000);
  assert.equal(buf.toString("ascii", 36, 40), "data");
});

test("encodeWav ChunkSize at offset 4 is 36 + dataLength", () => {
  const samples    = [0, 0, 0, 0]; // 4 samples × 2 bytes = 8 bytes data
  const buf        = encodeWav(samples, 24000);
  const chunkSize  = buf.readUInt32LE(4);
  const dataLength = samples.length * 2;
  assert.equal(chunkSize, 36 + dataLength);
});

test("encodeWav Subchunk1Size at offset 16 is 16 (PCM)", () => {
  const buf = encodeWav([0], 24000);
  assert.equal(buf.readUInt32LE(16), 16);
});

test("encodeWav AudioFormat at offset 20 is 1 (PCM linear)", () => {
  const buf = encodeWav([0], 24000);
  assert.equal(buf.readUInt16LE(20), 1);
});

test("encodeWav NumChannels at offset 22 is 1 (mono)", () => {
  const buf = encodeWav([0], 24000);
  assert.equal(buf.readUInt16LE(22), 1);
});

test("encodeWav SampleRate at offset 24 matches the argument", () => {
  const buf = encodeWav([0], 44100);
  assert.equal(buf.readUInt32LE(24), 44100);
});

test("encodeWav BitsPerSample at offset 34 is 16", () => {
  const buf = encodeWav([0], 24000);
  assert.equal(buf.readUInt16LE(34), 16);
});

test("encodeWav DataSize at offset 40 is samples.length × 2", () => {
  const samples = new Float32Array(100);
  const buf = encodeWav(samples, 24000);
  assert.equal(buf.readUInt32LE(40), samples.length * 2);
});

// ── PCM sample encoding ───────────────────────────────────────────────────────

test("encodeWav sample value 0 encodes to int16 0", () => {
  const buf = encodeWav([0], 24000);
  assert.equal(buf.readInt16LE(HEADER_SIZE), 0);
});

test("encodeWav sample value 1.0 encodes to int16 32767", () => {
  const buf = encodeWav([1.0], 24000);
  assert.equal(buf.readInt16LE(HEADER_SIZE), 32767);
});

test("encodeWav sample value -1.0 encodes to int16 -32767", () => {
  const buf = encodeWav([-1.0], 24000);
  assert.equal(buf.readInt16LE(HEADER_SIZE), -32767);
});

test("encodeWav clamps values > 1.0 to 32767", () => {
  const buf = encodeWav([2.0], 24000);
  assert.equal(buf.readInt16LE(HEADER_SIZE), 32767);
});

test("encodeWav clamps values < -1.0 to -32767", () => {
  const buf = encodeWav([-2.0], 24000);
  assert.equal(buf.readInt16LE(HEADER_SIZE), -32767);
});

test("encodeWav encodes multiple samples in order", () => {
  const samples = [0, 0.5, -0.5];
  const buf = encodeWav(samples, 24000);

  assert.equal(buf.readInt16LE(HEADER_SIZE),     0);
  assert.equal(buf.readInt16LE(HEADER_SIZE + 2), Math.round(0.5 * 32767));
  assert.equal(buf.readInt16LE(HEADER_SIZE + 4), Math.round(-0.5 * 32767));
});

test("encodeWav accepts Float32Array input", () => {
  const samples = new Float32Array([0, 0.25, 0.5, -0.25]);
  const buf = encodeWav(samples, 24000);
  assert.equal(buf.length, HEADER_SIZE + samples.length * 2);
  assert.ok(buf.toString("ascii", 0, 4) === "RIFF");
});

test("encodeWav produces non-empty output for non-empty input", () => {
  const buf = encodeWav([0.1, 0.2, 0.3], 24000);
  assert.ok(buf.length > HEADER_SIZE);
});
