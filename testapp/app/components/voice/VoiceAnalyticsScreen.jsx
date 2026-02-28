import { useEffect, useRef, useState } from "react";
import { PushToTalkButton } from "./PushToTalkButton.jsx";
import { TranscriptPanel } from "./TranscriptPanel.jsx";
import { AgentResponsePanel } from "./AgentResponsePanel.jsx";
import { PlaybackQueue } from "./PlaybackQueue.jsx";
import { ListenModeToggle } from "./ListenModeToggle.jsx";
import { SuggestedQuestions } from "./SuggestedQuestions.jsx";
import { TimeSeriesSyncChart } from "./TimeSeriesSyncChart.jsx";
import { useSpeechCapture } from "../../lib/voice/useSpeechCapture.js";
import { usePlaybackQueue } from "../../lib/voice/usePlaybackQueue.js";
import { useVoiceSession } from "../../lib/voice/useVoiceSession.js";

/* eslint-disable react/prop-types */
export function VoiceAnalyticsScreen({
  standaloneUrl = "",
  hideStandaloneCta = false,
  directAccessToken = "",
}) {
  const [textInput, setTextInput] = useState("");
  const [latestSeries, setLatestSeries] = useState(null);
  const lastQueuedResponseKeyRef = useRef("");
  const session = useVoiceSession({ directAccessToken });
  const playback = usePlaybackQueue();
  const speech = useSpeechCapture({
    onFinalTranscript: (transcript) => {
      submitPrompt(transcript, "speech");
    },
  });

  async function submitPrompt(prompt, source) {
    const utterance = prompt.trim();
    if (!utterance) {
      return;
    }

    const response = await session.submitUtterance(utterance, source);
    if (!response) {
      return;
    }

    setLatestSeries(response?.chart?.series ?? null);
  }

  useEffect(() => {
    const audioItems = session.latestResponse?.audio ?? [];
    if (!audioItems.length) {
      return;
    }

    const audioKey = audioItems
      .map((item) => `${item.type}:${item.audio_url}`)
      .join("|");
    const responseKey = `${session.transcript}|${session.playbackRate}|${audioKey}`;
    if (lastQueuedResponseKeyRef.current === responseKey) {
      return;
    }
    lastQueuedResponseKeyRef.current = responseKey;

    playback.enqueueResponseAudio(audioItems, session.playbackRate);
    playback.replay();
  }, [playback, session.latestResponse, session.playbackRate, session.transcript]);

  const supportedQuestions = [
    "How are we doing today?",
    "What changed versus yesterday?",
    "Show me this week's trend",
    "Play that trend again slower",
    "What caused the spike?",
  ];

  async function handleTextSubmit(event) {
    event.preventDefault();
    const utterance = textInput.trim();
    if (!utterance) {
      return;
    }

    await submitPrompt(utterance, "text");
    setTextInput("");
  }

  async function handleSuggestedQuestion(question) {
    await submitPrompt(question, "suggested");
  }

  function handleRateChange(nextRate) {
    session.setPlaybackRate(nextRate);
    playback.setPlaybackRate(nextRate);
  }

  function openInNewTab() {
    if (!standaloneUrl || typeof window === "undefined") {
      return;
    }

    window.open(standaloneUrl, "_blank", "noopener,noreferrer");
  }

  const showStandaloneCta = Boolean(standaloneUrl) && !hideStandaloneCta;

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 760 }}>
      <p style={{ margin: 0, color: "#637381", fontSize: 13 }}>
        Ask one question at a time. The assistant responds with concise speech and queued sonification.
      </p>

      {showStandaloneCta ? (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            padding: "10px 12px",
            borderRadius: 8,
            background: "#f6f8fa",
            border: "1px solid #dfe3e8",
          }}
        >
          <span style={{ fontSize: 12, color: "#52636f" }}>
            {speech.embeddedContext
              ? "Chrome can block microphone prompts inside Shopify&apos;s embedded iframe."
              : "If microphone access does not prompt here, try the standalone voice page on the app domain."}
          </span>
          <button
            type="button"
            onClick={openInNewTab}
            style={{
              border: "1px solid #c9cccf",
              borderRadius: 999,
              padding: "6px 10px",
              background: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Open voice in new tab
          </button>
        </div>
      ) : null}

      <PushToTalkButton
        speechRecognitionSupported={speech.speechRecognitionSupported}
        isRecording={speech.isRecording}
        disabled={session.isLoading}
        onPressStart={speech.start}
        onPressEnd={speech.stop}
      />

      <form onSubmit={handleTextSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          value={textInput}
          onChange={(event) => setTextInput(event.target.value)}
          placeholder={
            speech.speechRecognitionSupported
              ? "Type a fallback question"
              : "Type your question"
          }
          style={{
            flex: "1 1 340px",
            border: "1px solid #c9cccf",
            borderRadius: 4,
            padding: "8px 10px",
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={session.isLoading}
          style={{
            border: "none",
            borderRadius: 4,
            padding: "8px 12px",
            background: "#5c6ac4",
            color: "#fff",
            cursor: session.isLoading ? "not-allowed" : "pointer",
          }}
        >
          {session.isLoading ? "Sending..." : "Submit"}
        </button>
      </form>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {supportedQuestions.map((question) => (
          <button
            key={question}
            type="button"
            disabled={session.isLoading}
            onClick={() => handleSuggestedQuestion(question)}
            style={{
              border: "1px solid #c9cccf",
              borderRadius: 999,
              padding: "6px 10px",
              background: "#fff",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {question}
          </button>
        ))}
      </div>

      <ListenModeToggle
        enabled={session.listenMode}
        onChange={session.setListenMode}
      />

      {session.error || speech.error ? (
        <p style={{ margin: 0, color: "#de3618", fontSize: 13 }}>
          {speech.error || session.error}
        </p>
      ) : null}

      <TranscriptPanel
        transcript={session.transcript || speech.finalTranscript}
        interimTranscript={speech.interimTranscript}
        source={session.transcriptSource}
      />

      <AgentResponsePanel response={session.latestResponse} />

      <SuggestedQuestions
        questions={session.latestResponse?.display?.suggested_questions}
        disabled={session.isLoading}
        onSelect={handleSuggestedQuestion}
      />

      <PlaybackQueue
        queue={playback.queue}
        activeItemId={playback.activeItemId}
        playbackRate={playback.playbackRate}
        statusLabel={playback.statusLabel}
        onReplay={playback.replay}
        onStop={playback.stop}
        onRateChange={handleRateChange}
      />

      <TimeSeriesSyncChart
        series={latestSeries}
        activeProgress={playback.visualProgress}
        isToolCalling={session.isLoading}
        toolTrace={session.latestResponse?.tool_trace ?? []}
      />
    </div>
  );
}
