import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import { PushToTalkButton } from "../components/voice/PushToTalkButton.jsx";
import { TranscriptPanel } from "../components/voice/TranscriptPanel.jsx";
import { AgentResponsePanel } from "../components/voice/AgentResponsePanel.jsx";
import { PlaybackQueue } from "../components/voice/PlaybackQueue.jsx";
import { ListenModeToggle } from "../components/voice/ListenModeToggle.jsx";
import { SuggestedQuestions } from "../components/voice/SuggestedQuestions.jsx";
import { useSpeechCapture } from "../lib/voice/useSpeechCapture.js";
import { usePlaybackQueue } from "../lib/voice/usePlaybackQueue.js";
import { useVoiceSession } from "../lib/voice/useVoiceSession.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function VoiceAnalyticsRoute() {
  const [textInput, setTextInput] = useState("");
  const session = useVoiceSession();
  const playback = usePlaybackQueue();
  const speech = useSpeechCapture({
    onFinalTranscript: (transcript) => {
      session.submitUtterance(transcript, "speech");
    },
  });

  useEffect(() => {
    if (!session.latestResponse?.audio?.length) {
      return;
    }

    playback.enqueueResponseAudio(session.latestResponse.audio, session.playbackRate);
    playback.replay();
  }, [playback, session.latestResponse, session.playbackRate]);

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

    await session.submitUtterance(utterance, "text");
    setTextInput("");
  }

  async function handleSuggestedQuestion(question) {
    await session.submitUtterance(question, "suggested");
  }

  function handleRateChange(nextRate) {
    session.setPlaybackRate(nextRate);
    playback.setPlaybackRate(nextRate);
  }

  return (
    <s-page heading="Voice Analytics">
      <s-section>
        <div style={{ display: "grid", gap: 14, maxWidth: 760 }}>
          <p style={{ margin: 0, color: "#637381", fontSize: 13 }}>
            Ask one question at a time. The assistant responds with concise speech and queued sonification.
          </p>

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

          {session.error ? (
            <p style={{ margin: 0, color: "#de3618", fontSize: 13 }}>
              {session.error}
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
        </div>
      </s-section>
    </s-page>
  );
}