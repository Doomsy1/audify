/* eslint-disable react/prop-types */
export function TranscriptPanel({ transcript, interimTranscript, source }) {
  return (
    <section>
      <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Transcript</h3>
      <div
        style={{
          border: "1px solid #dfe3e8",
          borderRadius: 6,
          padding: 12,
          background: "#fff",
          minHeight: 72,
        }}
      >
        {transcript ? (
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong style={{ color: "#637381" }}>{source}:</strong> {transcript}
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: "#8c9196" }}>
            Start speaking or type your question below.
          </p>
        )}
        {interimTranscript ? (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#637381" }}>
            Listening: {interimTranscript}
          </p>
        ) : null}
      </div>
    </section>
  );
}

