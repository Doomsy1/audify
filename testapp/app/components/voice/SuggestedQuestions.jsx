/* eslint-disable react/prop-types */
export function SuggestedQuestions({ questions, disabled, onSelect }) {
  if (!questions?.length) {
    return null;
  }

  return (
    <section>
      <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Suggested Questions</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {questions.map((question) => (
          <button
            key={question}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(question)}
            style={{
              border: "1px solid #c9cccf",
              borderRadius: 999,
              padding: "6px 12px",
              background: "#fff",
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            {question}
          </button>
        ))}
      </div>
    </section>
  );
}

