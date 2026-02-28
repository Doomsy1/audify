/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import {
  normalizeSeriesPoints,
  resolvePlayheadIndex,
} from "../../lib/voice/timeseriesChart.js";

const CHART_WIDTH = 760;
const CHART_HEIGHT = 240;
const PAD = { top: 20, right: 12, bottom: 30, left: 12 };
const MIN_ZOOM_WINDOW = 28;
const MAX_ZOOM_WINDOW = 48;

function buildLinePath(points, toX, toY) {
  if (!points.length) return "";
  return points
    .map((point, index) => `${index ? "L" : "M"}${toX(point.i).toFixed(1)},${toY(point.v).toFixed(1)}`)
    .join(" ");
}

function movingAverage(points, radius = 2) {
  if (!points.length) return [];
  return points.map((point, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const item = points[index + offset];
      if (!item) continue;
      sum += item.v;
      count += 1;
    }
    return { ...point, v: count ? sum / count : point.v };
  });
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
  const points = normalized.map((point, index) => ({
    i: index,
    v: point.v,
    t: point.t,
  }));
  const smoothed = movingAverage(points, 2);
  const markerTrace = Array.isArray(toolTrace) ? toolTrace : [];

  const cursorProgress = isToolCalling ? toolCursorProgress : Math.max(0, Math.min(1, Number(activeProgress) || 0));
  const playheadIndex = resolvePlayheadIndex(points.length, cursorProgress);

  const zooming = points.length > MAX_ZOOM_WINDOW && (isToolCalling || cursorProgress > 0);
  const windowSize = Math.max(MIN_ZOOM_WINDOW, Math.min(MAX_ZOOM_WINDOW, points.length));
  const rawStart = playheadIndex - Math.floor(windowSize / 2);
  const viewStart = zooming ? Math.max(0, Math.min(points.length - windowSize, rawStart)) : 0;
  const viewEnd = zooming ? Math.min(points.length - 1, viewStart + windowSize - 1) : Math.max(0, points.length - 1);
  const visiblePoints = points.filter((point) => point.i >= viewStart && point.i <= viewEnd);
  const visibleSmoothed = smoothed.filter((point) => point.i >= viewStart && point.i <= viewEnd);

  const valueSet = [...visiblePoints.map((point) => point.v), ...visibleSmoothed.map((point) => point.v)];
  const valueMin = valueSet.length ? Math.min(...valueSet) : 0;
  const valueMax = valueSet.length ? Math.max(...valueSet) : 1;
  const valueRange = valueMax - valueMin || 1;
  const viewRange = Math.max(1, viewEnd - viewStart);

  const toX = (index) => PAD.left + ((index - viewStart) / viewRange) * innerWidth;
  const toY = (value) => PAD.top + innerHeight - ((value - valueMin) / valueRange) * innerHeight;
  const pathPrimary = buildLinePath(visiblePoints, toX, toY);
  const pathSmooth = buildLinePath(visibleSmoothed, toX, toY);
  const cursorX = toX(Math.max(viewStart, Math.min(viewEnd, playheadIndex)));
  const playheadPoint = points[playheadIndex];
  const playheadSmooth = smoothed[playheadIndex];

  return (
    <section aria-labelledby="timeseries-sync-heading">
      <h3 id="timeseries-sync-heading" style={{ margin: "0 0 6px", fontSize: 15 }}>
        Time Series
      </h3>
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#637381" }}>
        Always visible. Cursor scans during tool calls, zooms around activity, and locks to playback.
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
          aria-label="Time series line chart with synced tool and playback cursor"
          style={{ display: "block" }}
        >
          <rect x={PAD.left} y={PAD.top} width={innerWidth} height={innerHeight} fill="#fafbfb" stroke="#e1e3e5" />
          <line x1={PAD.left} y1={PAD.top + innerHeight} x2={PAD.left + innerWidth} y2={PAD.top + innerHeight} stroke="#d3dce7" />
          <line x1={PAD.left} y1={PAD.top + innerHeight / 2} x2={PAD.left + innerWidth} y2={PAD.top + innerHeight / 2} stroke="#dfe3e8" strokeDasharray="2,3" />
          <text x={PAD.left + 4} y={PAD.top - 5} fontSize="10" fill="#637381">
            <tspan fill="#5c6ac4">●</tspan> Trend
            <tspan dx="12" fill="#47c1bf">●</tspan>
            <tspan dx="4" fill="#637381">Smoothed</tspan>
          </text>

          {pathPrimary ? (
            <>
              <path d={pathPrimary} fill="none" stroke="#5c6ac4" strokeWidth="1.9" />
              <path d={pathSmooth} fill="none" stroke="#47c1bf" strokeWidth="1.4" opacity="0.95" />
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
                stroke="#de3618"
                strokeDasharray="2,3"
                strokeWidth="1"
                opacity="0.55"
              />
            );
          })}

          {(isToolCalling || pathPrimary) ? (
            <g>
              <line x1={cursorX} y1={PAD.top} x2={cursorX} y2={PAD.top + innerHeight} stroke="#ff6900" strokeWidth="2" />
              {playheadPoint ? (
                <circle cx={cursorX} cy={toY(playheadPoint.v)} r="4.5" fill="#5c6ac4" stroke="#fff" strokeWidth="1.5" />
              ) : null}
              {playheadSmooth ? (
                <circle cx={cursorX} cy={toY(playheadSmooth.v)} r="4.5" fill="#47c1bf" stroke="#fff" strokeWidth="1.5" />
              ) : null}
            </g>
          ) : null}

          <text x={PAD.left} y={CHART_HEIGHT - 8} fontSize="10" fill="#8c9196">
            {viewStart}
          </text>
          <text x={PAD.left + innerWidth - 18} y={CHART_HEIGHT - 8} fontSize="10" fill="#8c9196">
            {viewEnd}
          </text>
        </svg>
      </div>
    </section>
  );
}
