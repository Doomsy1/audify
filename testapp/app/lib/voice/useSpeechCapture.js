import { useCallback, useMemo, useRef, useState } from "react";
import { detectVoiceCapabilities } from "./featureDetection.js";

function getRecognitionClass(globalLike = typeof window !== "undefined" ? window : null) {
  if (!globalLike) {
    return null;
  }
  return globalLike.SpeechRecognition || globalLike.webkitSpeechRecognition || null;
}

function getNavigatorLike(globalLike = typeof window !== "undefined" ? window : null) {
  return globalLike?.navigator ?? null;
}

export function shouldRestartRecognitionSession({
  isPressing,
  hasFinalTranscript,
  hasFatalError,
}) {
  return isPressing && !hasFinalTranscript && !hasFatalError;
}

export function formatRecognitionError(errorCode) {
  switch (errorCode) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Allow microphone access for this site or use the text input fallback.";
    case "audio-capture":
      return "No microphone was detected. Connect a microphone or use the text input fallback.";
    case "network":
      return "Speech recognition lost network access. Try again or use the text input fallback.";
    case "no-speech":
      return "No speech was detected. Try again and speak before stopping.";
    case "aborted":
      return "";
    default:
      return errorCode ? `Speech recognition failed: ${errorCode}` : "Speech recognition failed to start.";
  }
}

export function buildMicrophoneAccessError({
  errorName,
  embeddedContext,
  secureContext,
}) {
  if (!secureContext) {
    return "Microphone access requires HTTPS or localhost. Open the app on a secure origin or use the text input fallback.";
  }

  if (
    errorName === "NotAllowedError" ||
    errorName === "SecurityError" ||
    errorName === "PermissionDeniedError"
  ) {
    if (embeddedContext) {
      return "Chrome is not prompting because this Shopify page is running inside an embedded iframe that blocks microphone access. Open the voice page in a new tab or use the text input fallback.";
    }

    return "Microphone access was blocked. Allow microphone access for this site or use the text input fallback.";
  }

  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return "No microphone was detected. Connect a microphone or use the text input fallback.";
  }

  return "Microphone access could not be started. Use the text input fallback.";
}

export function useSpeechCapture({ onFinalTranscript } = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const microphoneReadyRef = useRef(false);
  const isPressingRef = useRef(false);
  const hasFinalTranscriptRef = useRef(false);
  const hasFatalErrorRef = useRef(false);
  const restartTimerRef = useRef(null);
  const capabilities = useMemo(() => detectVoiceCapabilities(), []);

  const ensureMicrophoneAccess = useCallback(async () => {
    if (microphoneReadyRef.current) {
      return true;
    }

    const navigatorLike = getNavigatorLike();
    const getUserMedia = navigatorLike?.mediaDevices?.getUserMedia;

    if (!getUserMedia) {
      return true;
    }

    try {
      const stream = await getUserMedia.call(navigatorLike.mediaDevices, {
        audio: true,
      });

      for (const track of stream.getTracks()) {
        track.stop();
      }

      microphoneReadyRef.current = true;
      setError("");
      return true;
    } catch (microphoneError) {
      setError(
        buildMicrophoneAccessError({
          errorName: microphoneError?.name,
          embeddedContext: capabilities.embeddedContext,
          secureContext: capabilities.secureContext,
        }),
      );
      return false;
    }
  }, [capabilities.embeddedContext, capabilities.secureContext]);

  const beginRecognitionSession = useCallback(() => {
    const Recognition = getRecognitionClass();
    if (!Recognition) {
      setError("Browser speech recognition is unavailable. Use the text input fallback.");
      return false;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcriptChunk = result[0]?.transcript ?? "";
        if (result.isFinal) {
          final += transcriptChunk;
        } else {
          interim += transcriptChunk;
        }
      }

      if (interim) {
        setInterimTranscript(interim);
      }

      if (final) {
        const transcript = final.trim();
        if (transcript) {
          setFinalTranscript(transcript);
          setInterimTranscript("");
          setError("");
          hasFinalTranscriptRef.current = true;
          if (onFinalTranscript) {
            onFinalTranscript(transcript);
          }
        }
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (
        shouldRestartRecognitionSession({
          isPressing: isPressingRef.current,
          hasFinalTranscript: hasFinalTranscriptRef.current,
          hasFatalError: hasFatalErrorRef.current,
        })
      ) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (!isPressingRef.current) return;
          beginRecognitionSession();
        }, 80);
        return;
      }
      setIsRecording(false);
    };

    recognition.onerror = (event) => {
      const errorCode = event?.error || "";
      hasFatalErrorRef.current =
        errorCode === "not-allowed" || errorCode === "service-not-allowed";

      const nextError = formatRecognitionError(errorCode);
      if (nextError) {
        setError(nextError);
      }

      if (hasFatalErrorRef.current) {
        setIsRecording(false);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      setIsRecording(false);
      setError(
        error instanceof Error && error.message
          ? `Speech recognition could not start: ${error.message}`
          : "Speech recognition could not start. Use the text input fallback.",
      );
      return false;
    }
    setIsRecording(true);
    setError("");
    return true;
  }, [onFinalTranscript]);

  const stop = useCallback(() => {
    isPressingRef.current = false;
    clearTimeout(restartTimerRef.current);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const start = useCallback(() => {
    async function startRecognition() {
      if (recognitionRef.current) {
        return true;
      }

      isPressingRef.current = true;
      hasFinalTranscriptRef.current = false;
      hasFatalErrorRef.current = false;
      setInterimTranscript("");
      setFinalTranscript("");
      setError("");

      const microphoneReady = await ensureMicrophoneAccess();
      if (!microphoneReady) {
        isPressingRef.current = false;
        setIsRecording(false);
        return false;
      }

      return beginRecognitionSession();
    }

    return startRecognition();
  }, [beginRecognitionSession, ensureMicrophoneAccess]);

  return {
    ...capabilities,
    isRecording,
    interimTranscript,
    finalTranscript,
    error,
    start,
    stop,
  };
}
