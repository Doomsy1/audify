function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function writeAscii(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function encodeWav(samples, sampleRate) {
  const channelCount = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const scaled = Math.round(clamp(sample, -1, 1) * 32767);
    view.setInt16(offset, scaled, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

export function createToneWave({
  frequencies,
  durationMs,
  sampleRate = 24000,
  gain = 0.18,
}) {
  const safeFrequencies = Array.isArray(frequencies) && frequencies.length
    ? frequencies
    : [440];
  const totalSamples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const segmentSamples = Math.max(1, Math.floor(totalSamples / safeFrequencies.length));
  const releaseSamples = Math.max(1, Math.floor(sampleRate * 0.01));
  const samples = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i += 1) {
    const segmentIndex = Math.min(
      safeFrequencies.length - 1,
      Math.floor(i / segmentSamples),
    );
    const frequency = safeFrequencies[segmentIndex];
    const time = i / sampleRate;

    let envelope = 1;
    const segmentOffset = i % segmentSamples;
    if (segmentOffset < releaseSamples) {
      envelope = segmentOffset / releaseSamples;
    } else if (segmentSamples - segmentOffset < releaseSamples) {
      envelope = (segmentSamples - segmentOffset) / releaseSamples;
    }

    samples[i] = Math.sin(2 * Math.PI * frequency * time) * gain * clamp(envelope, 0, 1);
  }

  return encodeWav(samples, sampleRate);
}
