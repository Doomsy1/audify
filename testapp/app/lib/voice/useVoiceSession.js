import { useCallback, useMemo, useReducer } from "react";
import { VOICE_RESPONSE_ENDPOINT } from "../contracts/clientVoice.js";

function createSessionId() {
  return `voice_session_${Date.now().toString(36)}`;
}

function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function tryParseJson(bodyText) {
  if (!bodyText) {
    return null;
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  const bodyText = await response.text();
  const responseJson = tryParseJson(bodyText);

  return {
    contentType,
    bodyText,
    responseJson,
  };
}

export function formatVoiceRequestError({
  status,
  contentType,
  bodyText,
  responseJson,
}) {
  if (
    contentType.includes("text/html") ||
    bodyText.trim().startsWith("<!DOCTYPE") ||
    bodyText.trim().startsWith("<html")
  ) {
    return `Voice endpoint returned HTML (${status}). Verify /api/agent/respond exists and returns JSON.`;
  }

  if (responseJson?.error && typeof responseJson.error === "string") {
    return responseJson.error;
  }

  if (status >= 500) {
    return "Voice request failed with a server error";
  }

  return "Voice request failed";
}

export const initialVoiceSessionState = {
  transcript: "",
  transcriptSource: "text",
  isLoading: false,
  error: "",
  latestResponse: null,
  listenMode: false,
  playbackRate: 1,
  sessionId: createSessionId(),
};

export function buildVoiceRequestPayload({
  utterance,
  listenMode,
  sessionId,
  playbackRate,
  timezone = resolveTimezone(),
  requestId = createRequestId(),
}) {
  return {
    utterance,
    context: {
      tz: timezone,
      listen_mode: listenMode,
      client_request_id: requestId,
      session_id: sessionId,
    },
    overrides: {
      sonify_speed: playbackRate,
    },
  };
}

export function voiceSessionReducer(state, action) {
  if (action.type === "set:listen_mode") {
    return { ...state, listenMode: action.value };
  }

  if (action.type === "set:playback_rate") {
    return { ...state, playbackRate: action.value };
  }

  if (action.type === "request:start") {
    return {
      ...state,
      transcript: action.transcript,
      transcriptSource: action.source,
      isLoading: true,
      error: "",
    };
  }

  if (action.type === "request:success") {
    return {
      ...state,
      isLoading: false,
      error: "",
      latestResponse: action.response,
    };
  }

  if (action.type === "request:error") {
    return {
      ...state,
      isLoading: false,
      error: action.error,
    };
  }

  return state;
}

export function useVoiceSession() {
  const [state, dispatch] = useReducer(
    voiceSessionReducer,
    initialVoiceSessionState,
  );

  const submitUtterance = useCallback(async (utterance, source = "text") => {
    const trimmed = utterance.trim();
    if (!trimmed) {
      return null;
    }

    dispatch({
      type: "request:start",
      transcript: trimmed,
      source,
    });

    const payload = buildVoiceRequestPayload({
      utterance: trimmed,
      listenMode: state.listenMode,
      sessionId: state.sessionId,
      playbackRate: state.playbackRate,
    });

    try {
      const response = await fetch(VOICE_RESPONSE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const { contentType, bodyText, responseJson } = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(
          formatVoiceRequestError({
            status: response.status,
            contentType,
            bodyText,
            responseJson,
          }),
        );
      }

      if (!responseJson) {
        throw new Error(
          formatVoiceRequestError({
            status: response.status,
            contentType,
            bodyText,
            responseJson: null,
          }),
        );
      }

      dispatch({
        type: "request:success",
        response: responseJson,
      });

      return responseJson;
    } catch (error) {
      dispatch({
        type: "request:error",
        error: error instanceof Error ? error.message : "Voice request failed",
      });
      return null;
    }
  }, [state.listenMode, state.playbackRate, state.sessionId]);

  const actions = useMemo(
    () => ({
      setListenMode(value) {
        dispatch({ type: "set:listen_mode", value });
      },
      setPlaybackRate(value) {
        dispatch({ type: "set:playback_rate", value });
      },
      submitUtterance,
    }),
    [submitUtterance],
  );

  return {
    ...state,
    ...actions,
  };
}
