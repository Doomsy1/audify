/**
 * Server-side WAV encoder — no external dependencies.
 * Produces a valid RIFF/WAVE file with a standard 44-byte PCM header.
 *
 * Accepts either Float32Array or a plain number[] of samples in [-1, 1].
 */

/**
 * Encode PCM samples as a WAV Buffer.
 *
 * @param {Float32Array|number[]} samples   Audio samples in [-1, 1]
 * @param {number} [sampleRate=24000]
 * @param {number} [numChannels=1]          Only mono (1) is supported for now
 * @returns {Buffer}
 */
export function encodeWav(samples, sampleRate = 24000, numChannels = 1) {
  const bitsPerSample  = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength     = samples.length * bytesPerSample * numChannels;
  const buf            = Buffer.allocUnsafe(44 + dataLength);

  // RIFF chunk descriptor
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLength, 4);          // ChunkSize
  buf.write("WAVE", 8, "ascii");

  // fmt sub-chunk
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);                       // Subchunk1Size (PCM = 16)
  buf.writeUInt16LE(1,  20);                       // AudioFormat   (PCM = 1)
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // ByteRate
  buf.writeUInt16LE(numChannels * bytesPerSample, 32);              // BlockAlign
  buf.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLength, 40);

  // PCM samples — clamp to [-1, 1], scale to int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += bytesPerSample;
  }

  return buf;
}
