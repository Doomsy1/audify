/* eslint-disable react/prop-types */
export function ListenModeToggle({ enabled, onChange }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "#444",
      }}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      Listen Mode
      <span style={{ color: "#8c9196" }}>
        (shorter speech, stronger audio emphasis)
      </span>
    </label>
  );
}

