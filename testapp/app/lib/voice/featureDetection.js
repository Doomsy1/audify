function hasSpeechRecognition(globalLike) {
  if (!globalLike) {
    return false;
  }

  return Boolean(
    globalLike.SpeechRecognition || globalLike.webkitSpeechRecognition,
  );
}

function detectEmbeddedContext(globalLike) {
  if (!globalLike) {
    return false;
  }

  try {
    return globalLike.top !== globalLike.self;
  } catch {
    return true;
  }
}

export function detectVoiceCapabilities(globalLike = typeof window !== "undefined" ? window : null) {
  const speechRecognitionSupported = hasSpeechRecognition(globalLike);

  return {
    speechRecognitionSupported,
    fallbackToText: !speechRecognitionSupported,
    needsUserGestureForPlayback: true,
    embeddedContext: detectEmbeddedContext(globalLike),
    secureContext: Boolean(globalLike?.isSecureContext ?? true),
  };
}
