function hasSpeechRecognition(globalLike) {
  if (!globalLike) {
    return false;
  }

  return Boolean(
    globalLike.SpeechRecognition || globalLike.webkitSpeechRecognition,
  );
}

export function detectVoiceCapabilities(globalLike = globalThis?.window) {
  const speechRecognitionSupported = hasSpeechRecognition(globalLike);

  return {
    speechRecognitionSupported,
    fallbackToText: !speechRecognitionSupported,
    needsUserGestureForPlayback: true,
  };
}

