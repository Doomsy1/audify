/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";

const TOTAL = 180;
const CW = 680;
const PAD = { t: 10, b: 10, l: 4, r: 4 };
const INNER_W = CW - PAD.l - PAD.r;
const CHART_H = 150;
const INNER_H = CHART_H - PAD.t - PAD.b;

function mulberry32(seed) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fallbackSeriesPoints() {
  const rand = mulberry32(42);
  const points = [];
  for (let t = 0; t < TOTAL; t += 1) {
    const base = 120 + 26 * Math.sin((2 * Math.PI * t) / 18);
    const noise = (rand() - 0.5) * 10;
    points.push({ t: `d${t + 1}`, v: base + noise });
  }
  return points;
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function movingAverage(values, radius = 2) {
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const value = values[index + offset];
      if (!Number.isFinite(value)) continue;
      sum += value;
      count += 1;
    }
    return count ? sum / count : values[index];
  });
}

function normY(arr, height) {
  const vals = arr.filter((v) => Number.isFinite(v));
  if (!vals.length) return arr.map(() => height / 2);
  const min = Math.min(...vals);
  const range = (Math.max(...vals) - min) || 1;
  return arr.map((v) => (Number.isFinite(v) ? height - ((v - min) / range) * height : null));
}

function buildSvgPath(ys, lo, hi, toX, padTop) {
  let d = "";
  for (let i = lo; i <= hi; i += 1) {
    if (ys[i] == null) continue;
    const px = toX(i);
    const py = padTop + ys[i];
    d += d ? ` L${px.toFixed(1)},${py.toFixed(1)}` : `M${px.toFixed(1)},${py.toFixed(1)}`;
  }
  return d;
}

export function TimeSeriesSyncChart({
  series,
  activeProgress,
  isToolCalling,
  toolTrace,
}) {
  const [toolCursorProgress, setToolCursorProgress] = useState(0);

  useEffect(() => {
    if (!isToolCalling) {
      setToolCursorProgress(0);
      return undefined;
    }
    const interval = setInterval(() => {
      setToolCursorProgress((prev) => {
        const next = prev + 0.028;
        return next > 1 ? 0 : next;
      });
    }, 90);
    return () => clearInterval(interval);
  }, [isToolCalling]);

  const rawPoints = useMemo(() => {
    const points = series?.points?.length ? series.points : fallbackSeriesPoints();
    return points.slice(0, TOTAL).map((point, index) => ({
      i: index,
      t: point?.t ?? `d${index + 1}`,
      v: Number(point?.v ?? 0),
    }));
  }, [series]);

  const xData = rawPoints.map((point) => point.v);
  const yData = movingAverage(xData, 2);
  const nx = normY(xData, INNER_H);
  const ny = normY(yData, INNER_H);

  const viewStart = 0;
  const viewEnd = Math.max(0, rawPoints.length - 1);
  const viewLen = Math.max(1, viewEnd - viewStart);
  const toX = (i) => PAD.l + ((i - viewStart) / viewLen) * INNER_W;

  const pathX = buildSvgPath(nx, viewStart, viewEnd, toX, PAD.t);
  const pathY = buildSvgPath(ny, viewStart, viewEnd, toX, PAD.t);

  const markerTrace = Array.isArray(toolTrace) ? toolTrace : [];
  const cursorProgress = isToolCalling ? toolCursorProgress : clamp01(activeProgress);
  const playhead = Math.round(cursorProgress * Math.max(0, rawPoints.length - 1));
  const phX = Number.isFinite(playhead) ? toX(playhead) : null;
  const phYx = phX !== null && nx[playhead] != null ? PAD.t + nx[playhead] : null;
  const phYy = phX !== null && ny[playhead] != null ? PAD.t + ny[playhead] : null;

  return (
    <section aria-labelledby="timeseries-sync-heading">
      <h3 id="timeseries-sync-heading" style={{ margin: "0 0 6px", fontSize: 15 }}>
        Time Series
      </h3>
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#637381" }}>
        Legacy sonify graph view. Cursor sweeps during tool calls, then follows playback.
      </p>

      <div style={{ transform: isToolCalling ? "scale(1.01)" : "scale(1)", transformOrigin: "center top", transition: "transform 180ms ease" }}>
        <div style={{ fontSize: 11, color: "#555", marginBottom: 3, display: "flex", gap: 12, alignItems: "center" }}>
          <span><span style={{ color: "#5c6ac4" }}>●</span> Trend</span>
          <span><span style={{ color: "#47c1bf" }}>●</span> Smoothed</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#aaa" }}>
            tool calls = dashed markers
          </span>
        </div>
        <svg
          width="100%"
          viewBox={`0 0 ${CW} ${CHART_H}`}
          role="img"
          aria-label="Legacy style time series chart with synced playhead cursor"
          style={{
            display: "block",
            border: "1px solid #e1e3e5",
            borderRadius: 4,
            background: "#fafbfb",
          }}
        >
          <defs>
            <filter id="ph-glow">
              <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#ff6900" floodOpacity="0.65" />
            </filter>
          </defs>

          <line x1={PAD.l} y1={PAD.t + INNER_H} x2={PAD.l + INNER_W} y2={PAD.t + INNER_H} stroke="#ddd" strokeWidth={1} />
          <line x1={PAD.l} y1={PAD.t + INNER_H / 2} x2={PAD.l + INNER_W} y2={PAD.t + INNER_H / 2} stroke="#e1e3e5" strokeDasharray="2,2" strokeWidth={1} />

          {markerTrace.map((step, index) => {
            const x = PAD.l + ((index + 1) / (markerTrace.length + 1)) * INNER_W;
            return (
              <line
                key={`${step.tool}-${index}`}
                x1={x}
                y1={PAD.t}
                x2={x}
                y2={PAD.t + INNER_H}
                stroke="#de3618"
                strokeWidth={1}
                strokeDasharray="3,3"
                opacity={0.5}
              />
            );
          })}

          <path d={pathX} fill="none" stroke="#5c6ac4" strokeWidth="1.5" />
          <path d={pathY} fill="none" stroke="#47c1bf" strokeWidth="1.5" />

          {phX !== null ? (
            <g style={{ pointerEvents: "none" }} filter="url(#ph-glow)">
              <line x1={phX} y1={PAD.t} x2={phX} y2={PAD.t + INNER_H} stroke="#ff6900" strokeWidth={2} />
              {phYx !== null ? <circle cx={phX} cy={phYx} r={4.5} fill="#5c6ac4" stroke="#fff" strokeWidth={1.5} /> : null}
              {phYy !== null ? <circle cx={phX} cy={phYy} r={4.5} fill="#47c1bf" stroke="#fff" strokeWidth={1.5} /> : null}
              <rect x={phX - 14} y={PAD.t - 1} width={28} height={13} rx={3} fill="#ff6900" opacity={0.9} />
              <text x={phX} y={PAD.t + 9} textAnchor="middle" fill="#fff" fontSize={8} fontWeight="bold">
                {playhead}
              </text>
            </g>
          ) : null}
        </svg>
      </div>
    </section>
  );
}
