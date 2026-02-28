import { useCallback, useMemo, useRef, useState } from "react";
import { detectVoiceCapabilities } from "./featureDetection.js";

function getRecognitionClass(globalLike = globalThis?.window) {
  if (!globalLike) {
    return null;
  }
  return globalLike.SpeechRecognition || globalLike.webkitSpeechRecognition || null;
}

export function shouldRestartRecognitionSession({
  isPressing,
  hasFinalTranscript,
  hasFatalError,
}) {
  return isPressing && !hasFinalTranscript && !hasFatalError;
}

export function useSpeechCapture({ onFinalTranscript } = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const recognitionRef = useRef(null);
  const isPressingRef = useRef(false);
  const hasFinalTranscriptRef = useRef(false);
  const hasFatalErrorRef = useRef(false);
  const capabilities = useMemo(() => detectVoiceCapabilities(), []);

  const beginRecognitionSession = useCallback(() => {
    const Recognition = getRecognitionClass();
    if (!Recognition) {
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
        setFinalTranscript(transcript);
        setInterimTranscript("");
        hasFinalTranscriptRef.current = true;
        if (transcript && onFinalTranscript) {
          onFinalTranscript(transcript);
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
        beginRecognitionSession();
        return;
      }
      setIsRecording(false);
    };

    recognition.onerror = (event) => {
      const errorCode = event?.error || "";
      hasFatalErrorRef.current =
        errorCode === "not-allowed" || errorCode === "service-not-allowed";
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    return true;
  }, [onFinalTranscript]);

  const stop = useCallback(() => {
    isPressingRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const start = useCallback(() => {
    if (recognitionRef.current) {
      return true;
    }

    isPressingRef.current = true;
    hasFinalTranscriptRef.current = false;
    hasFatalErrorRef.current = false;
    setInterimTranscript("");
    setFinalTranscript("");
    return beginRecognitionSession();
  }, [beginRecognitionSession]);

  return {
    ...capabilities,
    isRecording,
    interimTranscript,
    finalTranscript,
    start,
    stop,
  };
}
