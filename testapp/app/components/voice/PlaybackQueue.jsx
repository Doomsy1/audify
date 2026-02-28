/* eslint-disable react/prop-types */
export function PlaybackQueue({
  queue,
  activeItemId,
  playbackRate,
  statusLabel,
  onReplay,
  onStop,
  onRateChange,
}) {
  return (
    <section>
      <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Playback Queue</h3>
      <div
        style={{
          border: "1px solid #dfe3e8",
          borderRadius: 6,
          padding: 12,
          background: "#fff",
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onReplay}
            style={{
              border: "none",
              borderRadius: 4,
              padding: "6px 12px",
              background: "#008060",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Replay
          </button>
          <button
            type="button"
            onClick={onStop}
            style={{
              border: "none",
              borderRadius: 4,
              padding: "6px 12px",
              background: "#de3618",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Stop
          </button>
          <label style={{ fontSize: 13, color: "#444", display: "flex", alignItems: "center", gap: 6 }}>
            Speed
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.25}
              value={playbackRate}
              onChange={(event) => onRateChange(Number(event.target.value))}
            />
            <span>{playbackRate.toFixed(2)}x</span>
          </label>
        </div>

        <p style={{ margin: "0 0 6px", fontSize: 12, color: "#637381" }}>{statusLabel}</p>
        {queue.length ? (
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {queue.map((item) => (
              <li key={item.id} style={{ fontSize: 13, marginBottom: 4 }}>
                <span style={{ fontWeight: item.id === activeItemId ? 700 : 400 }}>
                  {item.label}
                </span>{" "}
                <span style={{ color: "#637381" }}>
                  ({item.type}, {item.status})
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: "#8c9196" }}>
            No clips queued yet.
          </p>
        )}
      </div>
    </section>
  );
}

