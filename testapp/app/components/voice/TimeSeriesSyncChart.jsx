/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";

const TOTAL = 180;
const CW = 680;
const PAD = { t: 10, b: 10, l: 4, r: 4 };
const INNER_W = CW - PAD.l - PAD.r;
const CHART_H = 150;
const INNER_H = CHART_H - PAD.t - PAD.b;
const HANDLE_HW = 7;
const MIN_SEL = 7;
const DEFAULT_WINDOW_SHORT = 7;
const DEFAULT_WINDOW_LONG = 14;

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

function normalSample(rand, std = 3) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()) * std;
}

function generateFallbackData() {
  const rand = mulberry32(42);
  const x = new Array(TOTAL);
  const y = new Array(TOTAL);
  for (let t = 0; t < TOTAL; t += 1) {
    if (t < 60) {
      x[t] = 100 + 20 * Math.sin((2 * Math.PI * t) / 14);
      y[t] = 0.08 * x[t] + normalSample(rand, 1);
    } else if (t < 90) {
      x[t] = 250 + 30 * Math.sin((2 * Math.PI * t) / 7);
      y[t] = 0.08 * 100 + normalSample(rand, 2);
    } else if (t < 130) {
      x[t] = 120 + 25 * Math.sin((2 * Math.PI * t) / 14);
      y[t] = 0.08 * (t >= 3 ? x[t - 3] : x[0]) + normalSample(rand, 1.5);
    } else {
      x[t] = 110 + 15 * Math.sin((2 * Math.PI * t) / 14);
      y[t] = 0.03 * x[t] + normalSample(rand, 1);
    }
  }
  return { x, y };
}

function smoothSeries(values, radius = 2) {
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

function buildAgentData(series) {
  const points = series?.points ?? [];
  if (!points.length) {
    return generateFallbackData();
  }

  const values = points.map((point) => Number(point?.v ?? 0));
  const x = new Array(TOTAL).fill(values[0] ?? 0);
  for (let i = 0; i < TOTAL; i += 1) {
    const sourcePos = (i / Math.max(1, TOTAL - 1)) * Math.max(1, values.length - 1);
    const left = Math.floor(sourcePos);
    const right = Math.min(values.length - 1, Math.ceil(sourcePos));
    const t = sourcePos - left;
    const leftValue = values[left] ?? 0;
    const rightValue = values[right] ?? leftValue;
    x[i] = leftValue + (rightValue - leftValue) * t;
  }
  const y = smoothSeries(x, 2);
  return { x, y };
}

function pearson(a, b) {
  const n = a.length;
  if (n < 2) return 0;
  const ma = a.reduce((sum, value) => sum + value, 0) / n;
  const mb = b.reduce((sum, value) => sum + value, 0) / n;
  let num = 0;
  let da2 = 0;
  let db2 = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    num += da * db;
    da2 += da * da;
    db2 += db * db;
  }
  const den = Math.sqrt(da2 * db2);
  return den === 0 ? 0 : num / den;
}

function rollingCorr(x, y, window) {
  return x.map((_, index) => (
    index < window - 1
      ? null
      : pearson(x.slice(index - window + 1, index + 1), y.slice(index - window + 1, index + 1))
  ));
}

function globalZscore(arr) {
  const vals = arr.filter((value) => value !== null && Number.isFinite(value));
  if (!vals.length) return arr.map(() => 0);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
  return arr.map((value) => (value == null ? null : (value - mean) / std));
}

function divergenceEnergy(x, y) {
  const zx = globalZscore(x);
  const zy = globalZscore(y);
  return zx.map((value, index) => (value == null || zy[index] == null ? 0 : Math.abs(value - zy[index])));
}

function detectLag(x, y, maxLag = 7) {
  const n = x.length;
  const window = Math.min(28, n);
  const lags = new Array(n).fill(0);
  for (let t = window; t < n; t += 1) {
    const wx = x.slice(t - window, t);
    const wy = y.slice(t - window, t);
    let bestLag = 0;
    let bestCorr = -Infinity;
    for (let lag = -maxLag; lag <= maxLag; lag += 1) {
      const ax = [];
      const ay = [];
      for (let i = maxLag; i < window - maxLag; i += 1) {
        const j = i + lag;
        if (j >= 0 && j < window) {
          ax.push(wx[i]);
          ay.push(wy[j]);
        }
      }
      if (ax.length < 4) continue;
      const corr = pearson(ax, ay);
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    lags[t] = bestLag;
  }
  return lags;
}

function detectRegimeShifts(corr, threshold = 0.4) {
  const shifts = new Set();
  for (let i = 1; i < corr.length; i += 1) {
    if (corr[i] !== null && corr[i - 1] !== null && Math.abs(corr[i] - corr[i - 1]) > threshold) {
      shifts.add(i);
    }
  }
  return shifts;
}

function defaultRollingWindowForSelection(length) {
  return length < 40 ? DEFAULT_WINDOW_SHORT : DEFAULT_WINDOW_LONG;
}

function normY(arr, height) {
  const vals = arr.filter((value) => value !== null && Number.isFinite(value));
  if (!vals.length) return arr.map(() => height / 2);
  const min = Math.min(...vals);
  const range = (Math.max(...vals) - min) || 1;
  return arr.map((value) => (value == null ? null : height - ((value - min) / range) * height));
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

function BrushableChart({
  xData,
  yData,
  divEnergy,
  regimeShifts,
  selStart,
  selEnd,
  viewStart,
  viewEnd,
  planMarkers,
  playhead,
  showOverlays,
  isScrubbing,
  onSelChange,
  onViewChange,
  onBrushDragStart,
  onBrushDragEnd,
  onSeek,
  onScrubStart,
  onScrubEnd,
}) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const wheelRef = useRef(null);

  const viewLen = Math.max(1, viewEnd - viewStart);
  const toX = (i) => PAD.l + ((i - viewStart) / viewLen) * INNER_W;
  const toDay = (clientX) => {
    if (!svgRef.current) return 0;
    const { left } = svgRef.current.getBoundingClientRect();
    return viewStart + ((clientX - left - PAD.l) / INNER_W) * viewLen;
  };

  const visX = xData.slice(viewStart, viewEnd + 1);
  const visY = yData.slice(viewStart, viewEnd + 1);
  const nxSlice = normY(visX, INNER_H);
  const nySlice = normY(visY, INNER_H);
  const nx = new Array(TOTAL).fill(null);
  const ny = new Array(TOTAL).fill(null);
  for (let i = 0; i <= viewEnd - viewStart; i += 1) {
    nx[viewStart + i] = nxSlice[i];
    ny[viewStart + i] = nySlice[i];
  }

  const pathX = buildSvgPath(nx, viewStart, viewEnd, toX, PAD.t);
  const pathY = buildSvgPath(ny, viewStart, viewEnd, toX, PAD.t);

  const divRects = [];
  if (showOverlays) {
    const lo = Math.max(viewStart, selStart);
    const hi = Math.min(viewEnd, selEnd);
    let st = null;
    for (let i = lo; i <= hi; i += 1) {
      if (divEnergy[i] > 1.5 && st === null) st = i;
      if ((divEnergy[i] <= 1.5 || i === hi) && st !== null) {
        divRects.push({ x: toX(st), w: Math.max(toX(i) - toX(st), 1), key: st });
        st = null;
      }
    }
  }

  const visShifts = showOverlays ? [...regimeShifts].filter((i) => i >= viewStart && i <= viewEnd) : [];
  const visPlanMarkers = [...planMarkers].filter((marker) => marker.step >= viewStart && marker.step <= viewEnd);

  const selPxL = toX(selStart);
  const selPxR = toX(selEnd);
  const selInView = selEnd >= viewStart && selStart <= viewEnd;
  const phInView = playhead >= viewStart && playhead <= viewEnd;
  const phX = phInView ? toX(playhead) : null;
  const phYx = phInView && nx[playhead] != null ? PAD.t + nx[playhead] : null;
  const phYy = phInView && ny[playhead] != null ? PAD.t + ny[playhead] : null;

  function onPointerDown(event) {
    event.preventDefault();
    const { left } = svgRef.current.getBoundingClientRect();
    const mouseX = event.clientX - left;
    const lhPx = toX(selStart);
    const rhPx = toX(selEnd);
    let type;
    if (Math.abs(mouseX - lhPx) <= HANDLE_HW + 3) {
      type = "left";
      onBrushDragStart?.();
    } else if (Math.abs(mouseX - rhPx) <= HANDLE_HW + 3) {
      type = "right";
      onBrushDragStart?.();
    } else {
      type = "seek";
      const day = Math.round(Math.max(0, Math.min(TOTAL - 1, toDay(event.clientX))));
      onScrubStart?.();
      onSeek?.(day);
    }
    svgRef.current.setPointerCapture(event.pointerId);
    dragRef.current = { type, startSS: selStart, startSE: selEnd };
  }

  function onPointerMove(event) {
    if (!dragRef.current) return;
    const day = Math.round(Math.max(0, Math.min(TOTAL - 1, toDay(event.clientX))));
    if (dragRef.current.type === "left") {
      onSelChange(Math.max(0, Math.min(day, selEnd - MIN_SEL)), selEnd);
    } else if (dragRef.current.type === "right") {
      onSelChange(selStart, Math.min(TOTAL - 1, Math.max(day, selStart + MIN_SEL)));
    } else {
      onSeek?.(day);
    }
  }

  function onPointerUp() {
    if (!dragRef.current) return;
    const type = dragRef.current.type;
    dragRef.current = null;
    if (type === "left" || type === "right") onBrushDragEnd?.();
    else onScrubEnd?.();
  }

  useEffect(() => {
    wheelRef.current = (event) => {
      event.preventDefault();
      if (!svgRef.current) return;
      const { left } = svgRef.current.getBoundingClientRect();
      const mouseX = event.clientX - left;
      const cursorDay = viewStart + ((mouseX - PAD.l) / INNER_W) * viewLen;
      const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2;
      const newLen = Math.max(MIN_SEL + 1, Math.min(TOTAL, Math.round(viewLen * factor)));
      const frac = Math.max(0, Math.min(1, (mouseX - PAD.l) / INNER_W));
      let ns = Math.round(cursorDay - frac * newLen);
      ns = Math.max(0, Math.min(TOTAL - newLen, ns));
      onViewChange?.(ns, ns + newLen - 1);
    };
  });

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return undefined;
    const handler = (event) => wheelRef.current?.(event);
    element.addEventListener("wheel", handler, { passive: false });
    return () => element.removeEventListener("wheel", handler);
  }, []);

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, color: "#555", marginBottom: 3, display: "flex", gap: 12, alignItems: "center" }}>
        <span><span style={{ color: "#5c6ac4" }}>●</span> Traffic (x)</span>
        <span><span style={{ color: "#47c1bf" }}>●</span> Sales (y)</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#aaa" }}>
          handles = selection · drag/click = seek · scroll = zoom
        </span>
      </div>
      <svg
        ref={svgRef}
        width={CW}
        height={CHART_H}
        style={{
          display: "block",
          border: "1px solid #e1e3e5",
          borderRadius: 4,
          background: "#fafbfb",
          cursor: isScrubbing ? "col-resize" : "crosshair",
          touchAction: "none",
          userSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <filter id="ph-glow">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#ff6900" floodOpacity="0.65" />
          </filter>
        </defs>
        {divRects.map((rect) => (
          <rect key={rect.key} x={rect.x} y={PAD.t} width={rect.w} height={INNER_H} fill="rgba(222,54,24,0.08)" />
        ))}
        {visShifts.map((index) => (
          <line key={index} x1={toX(index)} y1={PAD.t} x2={toX(index)} y2={PAD.t + INNER_H} stroke="#de3618" strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
        ))}
        {visPlanMarkers.map((marker) => (
          <g key={`${marker.type}-${marker.step}`}>
            <line x1={toX(marker.step)} y1={PAD.t} x2={toX(marker.step)} y2={PAD.t + INNER_H} stroke="#00848e" strokeWidth={1.5} strokeDasharray="2,3" opacity={0.9} />
            <rect x={toX(marker.step) - 28} y={PAD.t + 2} width={56} height={12} rx={3} fill="#00848e" opacity={0.9} />
            <text x={toX(marker.step)} y={PAD.t + 10} textAnchor="middle" fill="#fff" fontSize={8} fontWeight="bold">
              {marker.label}
            </text>
          </g>
        ))}
        <path d={pathX} fill="none" stroke="#5c6ac4" strokeWidth="1.5" />
        <path d={pathY} fill="none" stroke="#47c1bf" strokeWidth="1.5" />
        {selInView && toX(Math.max(viewStart, selStart)) > PAD.l ? (
          <rect x={PAD.l} y={PAD.t} width={Math.max(0, toX(Math.max(viewStart, selStart)) - PAD.l)} height={INNER_H} fill="rgba(0,0,0,0.1)" style={{ pointerEvents: "none" }} />
        ) : null}
        {selInView && toX(Math.min(viewEnd, selEnd)) < PAD.l + INNER_W ? (
          <rect x={toX(Math.min(viewEnd, selEnd))} y={PAD.t} width={Math.max(0, PAD.l + INNER_W - toX(Math.min(viewEnd, selEnd)))} height={INNER_H} fill="rgba(0,0,0,0.1)" style={{ pointerEvents: "none" }} />
        ) : null}
        {!selInView ? (
          <rect x={PAD.l} y={PAD.t} width={INNER_W} height={INNER_H} fill="rgba(0,0,0,0.1)" style={{ pointerEvents: "none" }} />
        ) : null}
        {selInView ? (
          <rect
            x={Math.max(PAD.l, selPxL)}
            y={PAD.t}
            width={Math.max(0, Math.min(PAD.l + INNER_W, selPxR) - Math.max(PAD.l, selPxL))}
            height={INNER_H}
            fill="rgba(92,106,196,0.06)"
            stroke="rgba(92,106,196,0.3)"
            strokeWidth={0.5}
            style={{ pointerEvents: "none" }}
          />
        ) : null}
        {phX !== null ? (
          <g style={{ pointerEvents: "none" }} filter="url(#ph-glow)">
            <line x1={phX} y1={PAD.t} x2={phX} y2={PAD.t + INNER_H} stroke="#ff6900" strokeWidth={2} />
            {phYx !== null ? <circle cx={phX} cy={phYx} r={4.5} fill="#5c6ac4" stroke="#fff" strokeWidth={1.5} /> : null}
            {phYy !== null ? <circle cx={phX} cy={phYy} r={4.5} fill="#47c1bf" stroke="#fff" strokeWidth={1.5} /> : null}
            <rect x={phX - 14} y={PAD.t - 1} width={28} height={13} rx={3} fill="#ff6900" opacity={0.9} />
            <text x={phX} y={PAD.t + 9} textAnchor="middle" fill="white" fontSize={8} fontWeight="bold">
              {playhead}
            </text>
          </g>
        ) : null}
        {selStart >= viewStart && selStart <= viewEnd ? (
          <g style={{ cursor: "ew-resize" }}>
            <line x1={selPxL} y1={PAD.t} x2={selPxL} y2={PAD.t + INNER_H} stroke="#5c6ac4" strokeWidth={2} />
            <rect x={selPxL - HANDLE_HW} y={PAD.t + INNER_H / 2 - 12} width={HANDLE_HW * 2} height={24} rx={3} fill="#5c6ac4" />
            <text x={selPxL} y={PAD.t + INNER_H / 2 + 4} textAnchor="middle" fill="white" fontSize={9} fontWeight="bold" style={{ pointerEvents: "none" }}>
              {selStart}
            </text>
          </g>
        ) : null}
        {selEnd >= viewStart && selEnd <= viewEnd ? (
          <g style={{ cursor: "ew-resize" }}>
            <line x1={selPxR} y1={PAD.t} x2={selPxR} y2={PAD.t + INNER_H} stroke="#5c6ac4" strokeWidth={2} />
            <rect x={selPxR - HANDLE_HW} y={PAD.t + INNER_H / 2 - 12} width={HANDLE_HW * 2} height={24} rx={3} fill="#5c6ac4" />
            <text x={selPxR} y={PAD.t + INNER_H / 2 + 4} textAnchor="middle" fill="white" fontSize={9} fontWeight="bold" style={{ pointerEvents: "none" }}>
              {selEnd}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function CorrStrip({ corr, rhoE, regimeShifts, viewStart, viewEnd, playhead, showOverlays, rollingWindow }) {
  const H = 44;
  const IH = H - 8;
  const viewLen = Math.max(1, viewEnd - viewStart);
  const toX = (i) => PAD.l + ((i - viewStart) / viewLen) * INNER_W;
  const toY = (v) => 4 + ((1 - (v + 1) / 2) * IH);

  let dCorr = "";
  let dEma = "";
  for (let i = viewStart; i <= viewEnd; i += 1) {
    if (corr[i] !== null) {
      const x = toX(i).toFixed(1);
      const y = toY(corr[i]).toFixed(1);
      dCorr += dCorr ? ` L${x},${y}` : `M${x},${y}`;
    }
    if (rhoE[i] !== null) {
      const x = toX(i).toFixed(1);
      const y = toY(rhoE[i]).toFixed(1);
      dEma += dEma ? ` L${x},${y}` : `M${x},${y}`;
    }
  }

  const visShifts = showOverlays ? [...regimeShifts].filter((i) => i >= viewStart && i <= viewEnd) : [];
  const phInView = playhead >= viewStart && playhead <= viewEnd;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: "#888", marginBottom: 1, display: "flex", gap: 10 }}>
        <span>{rollingWindow}-day rolling corr (selection)</span>
        <span style={{ color: "#c97c2e" }}>— EMA smoothed (α=0.2)</span>
      </div>
      <svg width={CW} height={H} style={{ display: "block", border: "1px solid #e1e3e5", borderRadius: 4, background: "#fafbfb" }}>
        <line x1={PAD.l} y1={toY(0)} x2={PAD.l + INNER_W} y2={toY(0)} stroke="#ddd" strokeWidth={1} />
        {[0.65, 0.25, -0.25].map((threshold) => (
          <line key={threshold} x1={PAD.l} y1={toY(threshold)} x2={PAD.l + INNER_W} y2={toY(threshold)} stroke="#b8c0cc" strokeWidth={0.5} strokeDasharray="2,2" />
        ))}
        {visShifts.map((index) => (
          <line key={index} x1={toX(index)} y1={4} x2={toX(index)} y2={4 + IH} stroke="#de3618" strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
        ))}
        <path d={dCorr} fill="none" stroke="#f0b070" strokeWidth="1" opacity="0.5" />
        <path d={dEma} fill="none" stroke="#c97c2e" strokeWidth="1.5" />
        {phInView ? (
          <line x1={toX(playhead)} y1={4} x2={toX(playhead)} y2={4 + IH} stroke="#ff6900" strokeWidth={2} />
        ) : null}
        {phInView && rhoE[playhead] !== null ? (
          <circle cx={toX(playhead)} cy={toY(rhoE[playhead])} r={3.5} fill="#ff6900" stroke="#fff" strokeWidth={1} />
        ) : null}
      </svg>
    </div>
  );
}

export function TimeSeriesSyncChart({ series, activeProgress, isToolCalling, toolTrace }) {
  const [toolCursorProgress, setToolCursorProgress] = useState(0);
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(TOTAL - 1);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(TOTAL - 1);
  const [showOverlays, setShowOverlays] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [rollingWindow, setRollingWindow] = useState(DEFAULT_WINDOW_SHORT);

  const data = useMemo(() => buildAgentData(series), [series]);

  useEffect(() => {
    const maxWindow = Math.max(2, Math.min(30, selEnd - selStart));
    setRollingWindow(Math.min(defaultRollingWindowForSelection(selEnd - selStart + 1), maxWindow));
  }, [selEnd, selStart]);

  useEffect(() => {
    if (!isToolCalling) {
      setToolCursorProgress(0);
      return undefined;
    }
    const interval = setInterval(() => {
      setToolCursorProgress((prev) => {
        const next = prev + 0.03;
        return next > 1 ? 0 : next;
      });
    }, 90);
    return () => clearInterval(interval);
  }, [isToolCalling]);

  const selAnalytics = useMemo(() => {
    const sx = data.x.slice(selStart, selEnd + 1);
    const sy = data.y.slice(selStart, selEnd + 1);
    const window = Math.min(rollingWindow, Math.max(2, sx.length - 1));
    const rc = rollingCorr(sx, sy, window);
    const rd = divergenceEnergy(sx, sy);
    const rl = detectLag(sx, sy, 7);

    const rhoESlice = new Array(sx.length).fill(null);
    let ema = 0;
    let initialized = false;
    for (let i = 0; i < sx.length; i += 1) {
      if (rc[i] === null) continue;
      ema = initialized ? 0.8 * ema + 0.2 * rc[i] : rc[i];
      initialized = true;
      rhoESlice[i] = ema;
    }

    const corr = new Array(TOTAL).fill(null);
    const divE = new Array(TOTAL).fill(0);
    const lags = new Array(TOTAL).fill(0);
    const rhoE = new Array(TOTAL).fill(null);
    for (let i = 0; i < sx.length; i += 1) {
      corr[selStart + i] = rc[i];
      divE[selStart + i] = rd[i];
      lags[selStart + i] = rl[i];
      rhoE[selStart + i] = rhoESlice[i];
    }
    return { corr, divE, lags, rhoE, shifts: detectRegimeShifts(corr, 0.4) };
  }, [data.x, data.y, rollingWindow, selEnd, selStart]);

  const markerTrace = Array.isArray(toolTrace) ? toolTrace : [];
  const planMarkers = useMemo(() => markerTrace.map((entry, index) => ({
    type: "tool",
    label: String(entry?.tool ?? "tool").replace("metrics_", "").replace("sonify_", ""),
    step: Math.max(0, Math.min(TOTAL - 1, Math.round(((index + 1) / (markerTrace.length + 1)) * (TOTAL - 1)))),
  })), [markerTrace]);

  const cursorProgress = isToolCalling ? toolCursorProgress : Math.max(0, Math.min(1, Number(activeProgress) || 0));
  const playhead = Math.round(cursorProgress * (TOTAL - 1));

  function seekTo(day) {
    const next = Math.round(Math.max(0, Math.min(TOTAL - 1, day)));
    if (next < selStart) {
      const len = selEnd - selStart;
      const ns = Math.max(0, next);
      const ne = Math.min(TOTAL - 1, ns + len);
      setSelStart(ns);
      setSelEnd(ne);
    } else if (next > selEnd) {
      const len = selEnd - selStart;
      const ne = Math.min(TOTAL - 1, next);
      const ns = Math.max(0, ne - len);
      setSelStart(ns);
      setSelEnd(ne);
    }
  }

  return (
    <section aria-labelledby="timeseries-sync-heading">
      <h3 id="timeseries-sync-heading" style={{ margin: "0 0 6px", fontSize: 15 }}>
        Time Series
      </h3>
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#637381" }}>
        Legacy sonify graph behavior with agent data and tool-call markers.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => { setViewStart(selStart); setViewEnd(selEnd); }} style={{ padding: "4px 12px", background: "#5c6ac4", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          Zoom to selection
        </button>
        <button type="button" onClick={() => { setViewStart(0); setViewEnd(TOTAL - 1); }} style={{ padding: "4px 12px", background: "#637381", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          Reset zoom
        </button>
        <label style={{ fontSize: 12, color: "#444", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={showOverlays} onChange={(event) => setShowOverlays(event.target.checked)} />
          Overlays
        </label>
        <span style={{ fontSize: 11, color: "#aaa" }}>
          View: {viewStart}–{viewEnd}
        </span>
      </div>

      <BrushableChart
        xData={data.x}
        yData={data.y}
        divEnergy={selAnalytics.divE}
        regimeShifts={selAnalytics.shifts}
        selStart={selStart}
        selEnd={selEnd}
        viewStart={viewStart}
        viewEnd={viewEnd}
        planMarkers={planMarkers}
        playhead={playhead}
        showOverlays={showOverlays}
        isScrubbing={scrubbing}
        onSelChange={(ns, ne) => { setSelStart(ns); setSelEnd(ne); }}
        onViewChange={(vs, ve) => { setViewStart(Math.max(0, vs)); setViewEnd(Math.min(TOTAL - 1, ve)); }}
        onBrushDragStart={() => {}}
        onBrushDragEnd={() => {}}
        onSeek={seekTo}
        onScrubStart={() => setScrubbing(true)}
        onScrubEnd={() => setScrubbing(false)}
      />

      <CorrStrip
        corr={selAnalytics.corr}
        rhoE={selAnalytics.rhoE}
        regimeShifts={selAnalytics.shifts}
        viewStart={viewStart}
        viewEnd={viewEnd}
        playhead={playhead}
        showOverlays={showOverlays}
        rollingWindow={rollingWindow}
      />
    </section>
  );
}
