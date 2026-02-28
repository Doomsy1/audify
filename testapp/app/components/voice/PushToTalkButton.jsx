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

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={onPressStart}
      onPointerUp={onPressEnd}
      onPointerCancel={onPressEnd}
      onPointerLeave={onPressEnd}
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
      aria-label={isRecording ? "Release to send voice input" : "Hold to talk"}
    >
      {isRecording ? "Release to send" : "Hold to talk"}
    </button>
  );
}
