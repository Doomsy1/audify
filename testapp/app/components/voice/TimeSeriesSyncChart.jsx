/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import {
  normalizeSeriesPoints,
  resolvePlayheadIndex,
} from "../../lib/voice/timeseriesChart.js";

const CHART_WIDTH = 760;
const CHART_HEIGHT = 220;
const PAD = { top: 16, right: 14, bottom: 42, left: 44 };

function buildLinePath(points) {
  if (!points.length) return "";
  return points
    .map((point, index) => `${index ? "L" : "M"}${point.px.toFixed(1)},${point.py.toFixed(1)}`)
    .join(" ");
}

export function TimeSeriesSyncChart({
  series,
  activeProgress,
  isToolCalling,
  toolTrace,
}) {
  const normalized = useMemo(() => normalizeSeriesPoints(series?.points ?? []), [series]);
  const [toolCursorProgress, setToolCursorProgress] = useState(0);

  useEffect(() => {
    if (!isToolCalling) {
      setToolCursorProgress(0);
      return undefined;
    }
    const interval = setInterval(() => {
      setToolCursorProgress((prev) => {
        const next = prev + 0.035;
        return next > 1 ? 0 : next;
      });
    }, 80);
    return () => clearInterval(interval);
  }, [isToolCalling]);

  const innerWidth = CHART_WIDTH - PAD.left - PAD.right;
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const points = normalized.map((point) => ({
    ...point,
    px: PAD.left + point.x * innerWidth,
    py: PAD.top + (1 - point.y) * innerHeight,
  }));
  const path = buildLinePath(points);
  const markerTrace = Array.isArray(toolTrace) ? toolTrace : [];

  const cursorProgress = isToolCalling ? toolCursorProgress : Math.max(0, Math.min(1, Number(activeProgress) || 0));
  const cursorX = PAD.left + cursorProgress * innerWidth;
  const playheadIndex = resolvePlayheadIndex(points.length, cursorProgress);
  const playheadPoint = points[playheadIndex];

  return (
    <section aria-labelledby="timeseries-sync-heading">
      <h3 id="timeseries-sync-heading" style={{ margin: "0 0 6px", fontSize: 15 }}>
        Time Series
      </h3>
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#637381" }}>
        Always visible. Cursor scans during tool calls and locks to playback when audio starts.
      </p>

      <div
        style={{
          border: "1px solid #dfe3e8",
          borderRadius: 8,
          padding: 8,
          background: "#fff",
          transform: isToolCalling ? "scale(1.01)" : "scale(1)",
          transformOrigin: "center top",
          transition: "transform 180ms ease",
        }}
      >
        <svg
          width="100%"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label="Time series line chart with synced playback cursor"
          style={{ display: "block" }}
        >
          <rect x={PAD.left} y={PAD.top} width={innerWidth} height={innerHeight} fill="#f8fafc" stroke="#e5ebf2" />
          <line x1={PAD.left} y1={PAD.top + innerHeight} x2={PAD.left + innerWidth} y2={PAD.top + innerHeight} stroke="#d3dce7" />
          <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerHeight} stroke="#d3dce7" />

          {path ? (
            <>
              <path d={path} fill="none" stroke="#1f6feb" strokeWidth="2.2" />
              {playheadPoint ? (
                <circle cx={playheadPoint.px} cy={playheadPoint.py} r="4" fill="#0e8a5f" stroke="#fff" strokeWidth="1.4" />
              ) : null}
            </>
          ) : (
            <text x={PAD.left + 8} y={PAD.top + 22} fontSize="12" fill="#6b7280">
              No trend data yet. Ask the assistant to play a trend.
            </text>
          )}

          {markerTrace.map((step, index) => {
            const x = PAD.left + ((index + 1) / (markerTrace.length + 1)) * innerWidth;
            return (
              <line
                key={`${step.tool}-${index}`}
                x1={x}
                y1={PAD.top}
                x2={x}
                y2={PAD.top + innerHeight}
                stroke="#f59f00"
                strokeDasharray="2,3"
                strokeWidth="1.1"
              />
            );
          })}

          {(isToolCalling || path) ? (
            <line x1={cursorX} y1={PAD.top} x2={cursorX} y2={PAD.top + innerHeight} stroke="#de3618" strokeWidth="2" />
          ) : null}
        </svg>
      </div>
    </section>
  );
}
