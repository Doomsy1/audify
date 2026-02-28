/* eslint-disable react/prop-types */
export function PushToTalkButton({
  speechRecognitionSupported,
  isRecording,
  disabled,
  onPressStart,
  onPressEnd,
}) {
  if (!speechRecognitionSupported) {
    return (
      <div style={{ fontSize: 12, color: "#637381" }}>
        Browser speech recognition is unavailable. Use the text input fallback.
      </div>
    );
  }

  function handleClick() {
    if (disabled) {
      return;
    }

    if (isRecording) {
      onPressEnd?.();
      return;
    }

    onPressStart?.();
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={handleClick}
        style={{
          border: "none",
          borderRadius: 24,
          padding: "10px 16px",
          background: isRecording ? "#de3618" : "#008060",
          color: "#fff",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 14,
          fontWeight: 600,
        }}
        aria-pressed={isRecording}
        aria-label={isRecording ? "Stop and send voice input" : "Start voice input"}
      >
        {isRecording ? "Stop and send" : "Tap to talk"}
      </button>
      <span style={{ fontSize: 12, color: "#637381" }}>
        Tap once to start listening, then tap again to send your question.
      </span>
    </div>
  );
}
