export function AgentResponsePanel({ response }) {
  const bullets = response?.display?.bullets ?? [];

  return (
    <section>
      <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Agent Response</h3>
      <div
        style={{
          border: "1px solid #dfe3e8",
          borderRadius: 6,
          padding: 12,
          background: "#fff",
          minHeight: 72,
        }}
      >
        {response?.spoken ? (
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>{response.spoken}</p>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: "#8c9196" }}>
            Submit a question to receive a spoken and sonified response.
          </p>
        )}

        {bullets.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {bullets.map((bullet) => (
              <li key={bullet} style={{ fontSize: 13, marginBottom: 4 }}>
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

