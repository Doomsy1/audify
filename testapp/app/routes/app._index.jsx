import { useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import { PushToTalkButton } from "../components/voice/PushToTalkButton.jsx";
import { TranscriptPanel } from "../components/voice/TranscriptPanel.jsx";
import { AgentResponsePanel } from "../components/voice/AgentResponsePanel.jsx";
import { PlaybackQueue } from "../components/voice/PlaybackQueue.jsx";
import { ListenModeToggle } from "../components/voice/ListenModeToggle.jsx";
import { SuggestedQuestions } from "../components/voice/SuggestedQuestions.jsx";
import { ToolTraceGraph } from "../components/voice/ToolTraceGraph.jsx";
import { useSpeechCapture } from "../lib/voice/useSpeechCapture.js";
import { usePlaybackQueue } from "../lib/voice/usePlaybackQueue.js";
import { useVoiceSession } from "../lib/voice/useVoiceSession.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

function createInteractionId() {
  return `interaction_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function UnifiedAssistantRoute() {
  const [textInput, setTextInput] = useState("");
  const [interactionHistory, setInteractionHistory] = useState([]);
  const lastQueuedResponseKeyRef = useRef("");
  const session = useVoiceSession();
  const playback = usePlaybackQueue();
  const { enqueueResponseAudio, replay } = playback;

  async function submitPrompt(prompt, source) {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    const response = await session.submitUtterance(trimmed, source);
    if (!response) {
      return;
    }

    setInteractionHistory((previous) => [
      ...previous.slice(-7),
      {
        id: createInteractionId(),
        prompt: trimmed,
        source,
        tool_trace: response.tool_trace ?? [],
      },
    ]);
  }

  const speech = useSpeechCapture({
    onFinalTranscript: (transcript) => {
      submitPrompt(transcript, "speech");
    },
  });

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

    enqueueResponseAudio(audioItems, session.playbackRate);
    replay();
  }, [
    enqueueResponseAudio,
    replay,
    session.latestResponse,
    session.playbackRate,
    session.transcript,
  ]);

  const starterQuestions = [
    "How are we doing today?",
    "What changed versus yesterday?",
    "Show me this week's trend",
    "Play that trend again slower",
    "What caused the spike?",
  ];

  async function handleTextSubmit(event) {
    event.preventDefault();
    const prompt = textInput.trim();
    if (!prompt) {
      return;
    }

    await submitPrompt(prompt, "text");
    setTextInput("");
  }

  async function handleQuestionClick(question) {
    await submitPrompt(question, "suggested");
  }

  function handleRateChange(nextRate) {
    session.setPlaybackRate(nextRate);
    playback.setPlaybackRate(nextRate);
  }

  const backboardStatus = session.latestResponse?.meta?.backboard;

  return (
    <s-page heading="Analytics Assistant">
      <s-section>
        <div
          style={{
            "--ui-bg": "#f4f7fb",
            "--ui-surface": "#ffffff",
            "--ui-border": "#dfe3e8",
            "--ui-primary": "#1f6feb",
            "--ui-accent": "#0e8a5f",
            display: "grid",
            gap: 16,
            maxWidth: 980,
            padding: 6,
            background: "radial-gradient(circle at top right, #e8f0ff 0%, transparent 45%)",
          }}
        >
          <p style={{ margin: 0, color: "#52606d", fontSize: 13 }}>
            Ask questions by voice or text. Tool calls, response playback, and trend output stay together on one page.
          </p>

          <section
            aria-label="Ask the assistant"
            style={{
              border: "1px solid var(--ui-border)",
              borderRadius: 8,
              padding: 12,
              background: "var(--ui-surface)",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <PushToTalkButton
                speechRecognitionSupported={speech.speechRecognitionSupported}
                isRecording={speech.isRecording}
                disabled={session.isLoading}
                onPressStart={speech.start}
                onPressEnd={speech.stop}
              />
              <ListenModeToggle enabled={session.listenMode} onChange={session.setListenMode} />
            </div>

            <form onSubmit={handleTextSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label htmlFor="agent-prompt" style={{ display: "none" }}>
                Ask the analytics assistant
              </label>
              <input
                id="agent-prompt"
                type="text"
                value={textInput}
                onChange={(event) => setTextInput(event.target.value)}
                placeholder={speech.speechRecognitionSupported ? "Type a fallback question" : "Type your question"}
                style={{
                  flex: "1 1 380px",
                  border: "1px solid var(--ui-border)",
                  borderRadius: 6,
                  padding: "10px 12px",
                  fontSize: 14,
                }}
              />
              <button
                type="submit"
                disabled={session.isLoading}
                style={{
                  border: "none",
                  borderRadius: 6,
                  padding: "10px 14px",
                  background: "var(--ui-primary)",
                  color: "#fff",
                  cursor: session.isLoading ? "not-allowed" : "pointer",
                  fontWeight: 600,
                }}
              >
                {session.isLoading ? "Sending..." : "Send"}
              </button>
            </form>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {starterQuestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  disabled={session.isLoading}
                  onClick={() => handleQuestionClick(question)}
                  style={{
                    border: "1px solid var(--ui-border)",
                    borderRadius: 999,
                    padding: "6px 10px",
                    background: "#fff",
                    fontSize: 12,
                    cursor: session.isLoading ? "not-allowed" : "pointer",
                  }}
                >
                  {question}
                </button>
              ))}
            </div>

            <p
              role="status"
              aria-live="polite"
              style={{ margin: 0, color: session.error ? "#a0321c" : "#52606d", fontSize: 12 }}
            >
              {session.error
                ? session.error
                : session.isLoading
                  ? "Assistant is responding..."
                  : "Ready for your next question."}
            </p>
          </section>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <TranscriptPanel
              transcript={session.transcript || speech.finalTranscript}
              interimTranscript={speech.interimTranscript}
              source={session.transcriptSource}
            />
            <AgentResponsePanel response={session.latestResponse} />
          </div>

          <PlaybackQueue
            queue={playback.queue}
            activeItemId={playback.activeItemId}
            playbackRate={playback.playbackRate}
            statusLabel={playback.statusLabel}
            onReplay={playback.replay}
            onStop={playback.stop}
            onRateChange={handleRateChange}
          />

          <SuggestedQuestions
            questions={session.latestResponse?.display?.suggested_questions}
            disabled={session.isLoading}
            onSelect={handleQuestionClick}
          />

          <section
            aria-labelledby="backboard-status-heading"
            style={{
              border: "1px solid var(--ui-border)",
              borderRadius: 8,
              padding: 12,
              background: "var(--ui-surface)",
            }}
          >
            <h3 id="backboard-status-heading" style={{ margin: "0 0 6px", fontSize: 15 }}>
              Backboard Status
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: "#52606d" }}>
              {backboardStatus?.attempted
                ? (backboardStatus.refined
                  ? "Backboard refined the latest assistant response."
                  : "Backboard was called but the deterministic fallback response was used.")
                : "Backboard is not configured. The deterministic assistant response is active."}
            </p>
          </section>

          <ToolTraceGraph history={interactionHistory} />
        </div>
      </s-section>
    </s-page>
  );
}
