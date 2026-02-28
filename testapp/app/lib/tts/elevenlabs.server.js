import { putClip } from "../audio/clipStore.server";
import { createToneWave } from "../audio/simpleWave.server";

function buildFallbackSpeech(text) {
  const safeText = text || "Audio unavailable";
  const base = 360 + Math.min(180, safeText.length * 2);
  const frequencies = [base, base + 80, base + 40];
  const wav = createToneWave({
    frequencies,
    durationMs: Math.min(2200, Math.max(900, safeText.length * 24)),
    sampleRate: 24000,
    gain: 0.12,
  });

  const { clipId } = putClip({
    prefix: "tts",
    body: wav,
    contentType: "audio/wav",
  });

  return {
    clipId,
    audioUrl: `/api/tts/audio/${clipId}`,
    contentType: "audio/wav",
    provider: "fallback",
  };
}

export async function synthesizeSpeechClip({ text }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

  if (!text || !text.trim()) {
    return buildFallbackSpeech("Empty response");
  }

  if (!apiKey || !voiceId) {
    return buildFallbackSpeech(text);
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs request failed (${response.status})`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const { clipId } = putClip({
      prefix: "tts",
      body: bytes,
      contentType: "audio/mpeg",
    });

    return {
      clipId,
      audioUrl: `/api/tts/audio/${clipId}`,
      contentType: "audio/mpeg",
      provider: "elevenlabs",
    };
  } catch (_) {
    return buildFallbackSpeech(text);
  }
}
