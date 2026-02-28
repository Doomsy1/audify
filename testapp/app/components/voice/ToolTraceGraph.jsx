/* eslint-disable react/prop-types */
import { buildToolTraceSeries, TOOL_COLORS } from "../../lib/voice/toolTraceGraph.js";

function renderToolLabel(tool) {
  return tool.replaceAll("_", " ");
}

export function ToolTraceGraph({ history }) {
  const graph = buildToolTraceSeries(history, { limit: 8 });

  if (!graph.points.length) {
    return (
      <section aria-labelledby="tool-graph-heading">
        <h3 id="tool-graph-heading" style={{ margin: "0 0 6px", fontSize: 15 }}>
          Tool Calls
        </h3>
        <p style={{ margin: 0, fontSize: 13, color: "#637381" }}>
          Submit a question to start the live tool-call graph.
        </p>
      </section>
    );
  }

  const width = 720;
  const height = 180;
  const padding = { top: 12, right: 12, bottom: 36, left: 36 };
  const chartHeight = height - padding.top - padding.bottom;
  const slotWidth = (width - padding.left - padding.right) / graph.points.length;
  const barWidth = Math.max(18, slotWidth - 14);
  const yMax = Math.max(graph.maxTotal, 1);

  return (
    <section aria-labelledby="tool-graph-heading">
      <h3 id="tool-graph-heading" style={{ margin: "0 0 6px", fontSize: 15 }}>
        Tool Calls
      </h3>
      <p style={{ margin: "0 0 8px", color: "#637381", fontSize: 12 }}>
        Each bar shows tools called for one agent response. Updates after every prompt.
      </p>

      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Stacked bar chart showing recent agent tool calls"
        style={{
          display: "block",
          border: "1px solid #dfe3e8",
          borderRadius: 6,
          background: "#ffffff",
        }}
      >
        <line
          x1={padding.left}
          y1={padding.top + chartHeight}
          x2={width - padding.right}
          y2={padding.top + chartHeight}
          stroke="#dfe3e8"
          strokeWidth="1"
        />
        {graph.points.map((point, index) => {
          const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
          let stackedHeight = 0;

          const toolRects = graph.tools.map((tool) => {
            const count = point.byTool[tool] ?? 0;
            if (!count) {
              return null;
            }
            const heightPx = (count / yMax) * chartHeight;
            const y = padding.top + chartHeight - stackedHeight - heightPx;
            stackedHeight += heightPx;
            return (
              <rect
                key={`${point.id}:${tool}`}
                x={x}
                y={y}
                width={barWidth}
                height={heightPx}
                fill={TOOL_COLORS[tool] ?? "#6b7280"}
              />
            );
          });

          return (
            <g key={point.id}>
              {toolRects}
              <text
                x={x + barWidth / 2}
                y={padding.top + chartHeight + 14}
                textAnchor="middle"
                fontSize="10"
                fill="#4a5568"
              >
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {graph.tools.map((tool) => (
          <span
            key={tool}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "#445",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: TOOL_COLORS[tool] ?? "#6b7280",
              }}
            />
            {renderToolLabel(tool)}
          </span>
        ))}
      </div>

      <div style={{ marginTop: 12, border: "1px solid #dfe3e8", borderRadius: 6, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <caption style={{ textAlign: "left", padding: 8, color: "#637381" }}>
            Recent prompts and tool usage
          </caption>
          <thead>
            <tr style={{ textAlign: "left", background: "#f6f8fa" }}>
              <th style={{ padding: "6px 8px" }}>#</th>
              <th style={{ padding: "6px 8px" }}>Prompt</th>
              <th style={{ padding: "6px 8px" }}>Tools</th>
              <th style={{ padding: "6px 8px" }}>Calls</th>
            </tr>
          </thead>
          <tbody>
            {graph.points.map((point, index) => (
              <tr key={`row-${point.id}`} style={{ borderTop: "1px solid #eef2f7" }}>
                <td style={{ padding: "6px 8px", color: "#637381" }}>{index + 1}</td>
                <td style={{ padding: "6px 8px" }}>{point.prompt || "Untitled prompt"}</td>
                <td style={{ padding: "6px 8px", color: "#637381" }}>
                  {Object.keys(point.byTool).join(", ") || "none"}
                </td>
                <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>{point.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
