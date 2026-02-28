import { useState } from "react";
import { authenticate } from "../shopify.server";

const EXAMPLE_QUERIES = [
  "How are we doing today?",
  "Compare today to yesterday",
  "Play the last 7 days of revenue",
  "Play that trend again slower",
  "What caused the spike?",
];

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function VoiceTestPage() {
  const [utterance, setUtterance] = useState(EXAMPLE_QUERIES[0]);
  const [listenMode, setListenMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState(null);

  async function submitUtterance(nextUtterance) {
    const trimmed = nextUtterance.trim();
    if (!trimmed) {
      setError("Enter a question first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/agent/respond", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          utterance: trimmed,
          context: {
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            listen_mode: listenMode,
            client_request_id: `voice_test_${Date.now()}`,
            session_id: "voice_test_page",
          },
          overrides: {
            metric: "revenue",
            sonify_speed: 1,
          },
        }),
      });

      const payload = await res.json();
      if (!res.ok || payload?.ok === false) {
        throw new Error(payload?.error || "Request failed");
      }

      setResponse(payload);
    } catch (requestError) {
      setResponse(null);
      setError(requestError instanceof Error ? requestError.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <s-page heading="Voice Agent Test">
      <s-section heading="Quick Test Harness">
        <div style={{ display: "grid", gap: 12, maxWidth: 760 }}>
          <p style={{ margin: 0, color: "#52636f", fontSize: 14 }}>
            This page calls the new agent endpoint directly. It uses the current
            authenticated Shopify session, mock metrics, and server-generated
            demo audio.
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {EXAMPLE_QUERIES.map((query) => (
              <button
                key={query}
                onClick={() => setUtterance(query)}
                style={smallButtonStyle("#eef5f7", "#17313a")}
              >
                {query}
              </button>
            ))}
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Utterance</span>
            <textarea
              rows={3}
              value={utterance}
              onChange={(event) => setUtterance(event.target.value)}
              style={textareaStyle}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={listenMode}
              onChange={(event) => setListenMode(event.target.checked)}
            />
            <span>Listen mode (shorter spoken response)</span>
          </label>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => submitUtterance(utterance)}
              disabled={loading}
              style={primaryButtonStyle}
            >
              {loading ? "Running..." : "Send To Agent"}
            </button>
            <span style={{ color: "#52636f", fontSize: 13 }}>
              Session id is fixed to <code>voice_test_page</code> so follow-up prompts reuse memory.
            </span>
          </div>

          {error ? (
            <div style={errorStyle}>
              {error}
            </div>
          ) : null}
        </div>
      </s-section>

      <s-section heading="Response">
        {!response ? (
          <p style={{ margin: 0, color: "#52636f" }}>
            Submit a query to see the structured response and test returned audio clips.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
            <div style={cardStyle}>
              <div style={cardLabelStyle}>Spoken</div>
              <div>{response.spoken}</div>
            </div>

            <div style={cardStyle}>
              <div style={cardLabelStyle}>Bullets</div>
              <ul style={{ margin: "6px 0 0 18px" }}>
                {(response.display?.bullets ?? []).map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </div>

            <div style={cardStyle}>
              <div style={cardLabelStyle}>Suggested Questions</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {(response.display?.suggested_questions ?? []).map((question) => (
                  <button
                    key={question}
                    onClick={() => {
                      setUtterance(question);
                      submitUtterance(question);
                    }}
                    style={smallButtonStyle("#f2f0ff", "#31206f")}
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={cardLabelStyle}>Audio Clips</div>
              <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
                {(response.audio ?? []).map((item) => (
                  <div key={`${item.type}:${item.audio_url}`} style={audioRowStyle}>
                    <div>
                      <strong>{item.label}</strong>
                      <div style={{ fontSize: 12, color: "#52636f" }}>{item.type}</div>
                    </div>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio controls preload="none" src={item.audio_url} />
                  </div>
                ))}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={cardLabelStyle}>Tool Trace</div>
              <pre style={preStyle}>
                {JSON.stringify(response.tool_trace ?? [], null, 2)}
              </pre>
            </div>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const textareaStyle = {
  width: "100%",
  maxWidth: 760,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #c9d3d8",
  fontSize: 14,
  fontFamily: "inherit",
  resize: "vertical",
};

const primaryButtonStyle = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  background: "#0f766e",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};

const cardStyle = {
  border: "1px solid #dde5ea",
  borderRadius: 10,
  padding: 14,
  background: "#fff",
};

const cardLabelStyle = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#52636f",
  marginBottom: 6,
};

const errorStyle = {
  borderRadius: 8,
  padding: "10px 12px",
  background: "#fff1f1",
  color: "#9f1c1c",
  border: "1px solid #f3c7c7",
};

const audioRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const preStyle = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  background: "#f6f8fa",
  borderRadius: 8,
  padding: 12,
  overflowX: "auto",
};

function smallButtonStyle(background, color) {
  return {
    padding: "7px 10px",
    borderRadius: 999,
    border: "1px solid rgba(0, 0, 0, 0.08)",
    background,
    color,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}
