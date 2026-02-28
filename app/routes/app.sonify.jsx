/* eslint-disable react/prop-types */
import { authenticate } from "../shopify.server";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHORD_NAMES,
  createSonificationAudioEngine,
} from "../lib/sonification/audioEngine";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

// ── Seeded PRNG ───────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normalSample(rand, std = 3) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()) * std;
}

// ── Synthetic data ────────────────────────────────────────────────────────────
function generateData() {
  const rand = mulberry32(42);
  const N = 180;
  const x = new Array(N);
  const y = new Array(N);
  for (let t = 0; t < N; t++) {
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

// ── Stats ─────────────────────────────────────────────────────────────────────
function pearson(a, b) {
  const n = a.length;
  if (n < 2) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da2 = 0, db2 = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    num += da * db; da2 += da * da; db2 += db * db;
  }
  const den = Math.sqrt(da2 * db2);
  return den === 0 ? 0 : num / den;
}
function rollingCorr(x, y, w) {
  return x.map((_, i) =>
    i < w - 1 ? null : pearson(x.slice(i - w + 1, i + 1), y.slice(i - w + 1, i + 1))
  );
}
function globalZscore(arr) {
  const vals = arr.filter(v => v !== null && isFinite(v));
  if (!vals.length) return arr.map(() => 0);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std  = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
  return arr.map(v => (v == null ? null : (v - mean) / std));
}
function divergenceEnergy(x, y) {
  const zx = globalZscore(x), zy = globalZscore(y);
  return zx.map((v, i) => (v == null || zy[i] == null ? 0 : Math.abs(v - zy[i])));
}
function detectLag(x, y, maxLag = 7) {
  const N = x.length, W = Math.min(28, N);
  const lags = new Array(N).fill(0);
  for (let t = W; t < N; t++) {
    const wx = x.slice(t - W, t), wy = y.slice(t - W, t);
    let bestLag = 0, bestCorr = -Infinity;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const ax = [], ay = [];
      for (let i = maxLag; i < W - maxLag; i++) {
        const j = i + lag;
        if (j >= 0 && j < W) { ax.push(wx[i]); ay.push(wy[j]); }
      }
      if (ax.length < 4) continue;
      const c = pearson(ax, ay);
      if (c > bestCorr) { bestCorr = c; bestLag = lag; }
    }
    lags[t] = bestLag;
  }
  return lags;
}
function detectRegimeShifts(corr, threshold = 0.4) {
  const shifts = new Set();
  for (let i = 1; i < corr.length; i++) {
    if (corr[i] !== null && corr[i - 1] !== null &&
        Math.abs(corr[i] - corr[i - 1]) > threshold) shifts.add(i);
  }
  return shifts;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TOTAL     = 180;
const CW        = 680;
const PAD       = { t: 10, b: 10, l: 4, r: 4 };
const INNER_W   = CW - PAD.l - PAD.r;
const CHART_H   = 150;
const INNER_H   = CHART_H - PAD.t - PAD.b;
const HANDLE_HW = 7;
const MIN_SEL   = 7;

// ── SVG helpers ───────────────────────────────────────────────────────────────
function normY(arr, H) {
  const vals = arr.filter(v => v !== null && isFinite(v));
  if (!vals.length) return arr.map(() => H / 2);
  const min = Math.min(...vals), range = (Math.max(...vals) - min) || 1;
  return arr.map(v => (v == null ? null : H - ((v - min) / range) * H));
}
function buildSvgPath(ys, lo, hi, toX, padT) {
  let d = "";
  for (let i = lo; i <= hi; i++) {
    if (ys[i] == null) continue;
    const px = toX(i), py = padT + ys[i];
    d += d ? ` L${px.toFixed(1)},${py.toFixed(1)}` : `M${px.toFixed(1)},${py.toFixed(1)}`;
  }
  return d;
}

// ── BrushableChart ────────────────────────────────────────────────────────────
function BrushableChart({
  xData, yData, divEnergy, regimeShifts,
  selStart, selEnd, viewStart, viewEnd,
  planMarkers,
  playhead, showOverlays, isScrubbing,
  onSelChange, onViewChange,
  onBrushDragStart, onBrushDragEnd,
  onSeek, onScrubStart, onScrubEnd,
}) {
  const svgRef   = useRef(null);
  const dragRef  = useRef(null);
  const wheelRef = useRef(null);

  const viewLen = Math.max(1, viewEnd - viewStart);
  const toX   = i => PAD.l + ((i - viewStart) / viewLen) * INNER_W;
  const toDay = clientX => {
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
  for (let i = 0; i <= viewEnd - viewStart; i++) {
    nx[viewStart + i] = nxSlice[i];
    ny[viewStart + i] = nySlice[i];
  }

  const pathX = buildSvgPath(nx, viewStart, viewEnd, toX, PAD.t);
  const pathY = buildSvgPath(ny, viewStart, viewEnd, toX, PAD.t);

  const divRects = [];
  if (showOverlays) {
    const lo = Math.max(viewStart, selStart), hi = Math.min(viewEnd, selEnd);
    let st = null;
    for (let i = lo; i <= hi; i++) {
      if (divEnergy[i] > 1.5 && st === null) st = i;
      if ((divEnergy[i] <= 1.5 || i === hi) && st !== null) {
        divRects.push({ x: toX(st), w: Math.max(toX(i) - toX(st), 1), key: st });
        st = null;
      }
    }
  }
  const visShifts = showOverlays
    ? [...regimeShifts].filter(i => i >= viewStart && i <= viewEnd) : [];
  const visPlanMarkers = [...planMarkers].filter(marker => marker.step >= viewStart && marker.step <= viewEnd);

  const selPxL    = toX(selStart);
  const selPxR    = toX(selEnd);
  const selInView = selEnd >= viewStart && selStart <= viewEnd;
  const phInView  = playhead >= viewStart && playhead <= viewEnd;
  const phX       = phInView ? toX(playhead) : null;
  const phYx      = phInView && nx[playhead] != null ? PAD.t + nx[playhead] : null;
  const phYy      = phInView && ny[playhead] != null ? PAD.t + ny[playhead] : null;

  function onPointerDown(e) {
    e.preventDefault();
    const { left } = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - left;
    const lhPx = toX(selStart), rhPx = toX(selEnd);
    let type;
    if (Math.abs(mouseX - lhPx) <= HANDLE_HW + 3) {
      type = "left"; onBrushDragStart?.();
    } else if (Math.abs(mouseX - rhPx) <= HANDLE_HW + 3) {
      type = "right"; onBrushDragStart?.();
    } else {
      type = "seek";
      const day = Math.round(Math.max(0, Math.min(TOTAL - 1, toDay(e.clientX))));
      onScrubStart?.(); onSeek?.(day);
    }
    svgRef.current.setPointerCapture(e.pointerId);
    dragRef.current = { type, startClientX: e.clientX, startSS: selStart, startSE: selEnd };
  }

  function onPointerMove(e) {
    if (!dragRef.current) return;
    const { type } = dragRef.current;
    const day = Math.round(Math.max(0, Math.min(TOTAL - 1, toDay(e.clientX))));
    if (type === "left") {
      onSelChange(Math.max(0, Math.min(day, selEnd - MIN_SEL)), selEnd);
    } else if (type === "right") {
      onSelChange(selStart, Math.min(TOTAL - 1, Math.max(day, selStart + MIN_SEL)));
    } else {
      onSeek?.(day);
    }
  }

  function onPointerUp() {
    if (!dragRef.current) return;
    const { type } = dragRef.current;
    dragRef.current = null;
    if (type === "left" || type === "right") onBrushDragEnd?.();
    else onScrubEnd?.();
  }

  useEffect(() => {
    wheelRef.current = (e) => {
      e.preventDefault();
      if (!svgRef.current) return;
      const { left } = svgRef.current.getBoundingClientRect();
      const mouseX    = e.clientX - left;
      const cursorDay = viewStart + ((mouseX - PAD.l) / INNER_W) * viewLen;
      const factor    = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      const newLen    = Math.max(MIN_SEL + 1, Math.min(TOTAL, Math.round(viewLen * factor)));
      const frac      = Math.max(0, Math.min(1, (mouseX - PAD.l) / INNER_W));
      let ns = Math.round(cursorDay - frac * newLen);
      ns = Math.max(0, Math.min(TOTAL - newLen, ns));
      onViewChange?.(ns, ns + newLen - 1);
    };
  });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const h = (e) => wheelRef.current?.(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
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
        ref={svgRef} width={CW} height={CHART_H}
        style={{ display: "block", border: "1px solid #e1e3e5", borderRadius: 4,
                 background: "#fafbfb", cursor: isScrubbing ? "col-resize" : "crosshair",
                 touchAction: "none", userSelect: "none" }}
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
        {divRects.map(r => (
          <rect key={r.key} x={r.x} y={PAD.t} width={r.w} height={INNER_H} fill="rgba(222,54,24,0.08)" />
        ))}
        {visShifts.map(i => (
          <line key={i} x1={toX(i)} y1={PAD.t} x2={toX(i)} y2={PAD.t + INNER_H}
            stroke="#de3618" strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
        ))}
        {visPlanMarkers.map(marker => (
          <g key={`${marker.type}-${marker.step}`}>
            <line x1={toX(marker.step)} y1={PAD.t} x2={toX(marker.step)} y2={PAD.t + INNER_H}
              stroke="#00848e" strokeWidth={1.5} strokeDasharray="2,3" opacity={0.9} />
            <rect x={toX(marker.step) - 28} y={PAD.t + 2} width={56} height={12} rx={3} fill="#00848e" opacity={0.9} />
            <text x={toX(marker.step)} y={PAD.t + 10} textAnchor="middle" fill="#fff" fontSize={8} fontWeight="bold">
              {marker.label}
            </text>
          </g>
        ))}
        <path d={pathX} fill="none" stroke="#5c6ac4" strokeWidth="1.5" />
        <path d={pathY} fill="none" stroke="#47c1bf" strokeWidth="1.5" />
        {selInView && toX(Math.max(viewStart, selStart)) > PAD.l && (
          <rect x={PAD.l} y={PAD.t}
            width={Math.max(0, toX(Math.max(viewStart, selStart)) - PAD.l)} height={INNER_H}
            fill="rgba(0,0,0,0.1)" style={{ pointerEvents: "none" }} />
        )}
        {selInView && toX(Math.min(viewEnd, selEnd)) < PAD.l + INNER_W && (
          <rect x={toX(Math.min(viewEnd, selEnd))} y={PAD.t}
            width={Math.max(0, PAD.l + INNER_W - toX(Math.min(viewEnd, selEnd)))} height={INNER_H}
            fill="rgba(0,0,0,0.1)" style={{ pointerEvents: "none" }} />
        )}
        {!selInView && (
          <rect x={PAD.l} y={PAD.t} width={INNER_W} height={INNER_H}
            fill="rgba(0,0,0,0.1)" style={{ pointerEvents: "none" }} />
        )}
        {selInView && (
          <rect
            x={Math.max(PAD.l, selPxL)} y={PAD.t}
            width={Math.max(0, Math.min(PAD.l + INNER_W, selPxR) - Math.max(PAD.l, selPxL))}
            height={INNER_H}
            fill="rgba(92,106,196,0.06)" stroke="rgba(92,106,196,0.3)" strokeWidth={0.5}
            style={{ pointerEvents: "none" }}
          />
        )}
        {phX !== null && (
          <g style={{ pointerEvents: "none" }} filter="url(#ph-glow)">
            <line x1={phX} y1={PAD.t} x2={phX} y2={PAD.t + INNER_H}
              stroke="#ff6900" strokeWidth={2} />
            {phYx !== null && <circle cx={phX} cy={phYx} r={4.5} fill="#5c6ac4" stroke="#fff" strokeWidth={1.5} />}
            {phYy !== null && <circle cx={phX} cy={phYy} r={4.5} fill="#47c1bf" stroke="#fff" strokeWidth={1.5} />}
            <rect x={phX - 14} y={PAD.t - 1} width={28} height={13} rx={3} fill="#ff6900" opacity={0.9} />
            <text x={phX} y={PAD.t + 9} textAnchor="middle" fill="white" fontSize={8} fontWeight="bold">{playhead}</text>
          </g>
        )}
        {selStart >= viewStart && selStart <= viewEnd && (
          <g style={{ cursor: "ew-resize" }}>
            <line x1={selPxL} y1={PAD.t} x2={selPxL} y2={PAD.t + INNER_H} stroke="#5c6ac4" strokeWidth={2} />
            <rect x={selPxL - HANDLE_HW} y={PAD.t + INNER_H / 2 - 12} width={HANDLE_HW * 2} height={24} rx={3} fill="#5c6ac4" />
            <text x={selPxL} y={PAD.t + INNER_H / 2 + 4} textAnchor="middle" fill="white" fontSize={9} fontWeight="bold" style={{ pointerEvents: "none" }}>{selStart}</text>
          </g>
        )}
        {selEnd >= viewStart && selEnd <= viewEnd && (
          <g style={{ cursor: "ew-resize" }}>
            <line x1={selPxR} y1={PAD.t} x2={selPxR} y2={PAD.t + INNER_H} stroke="#5c6ac4" strokeWidth={2} />
            <rect x={selPxR - HANDLE_HW} y={PAD.t + INNER_H / 2 - 12} width={HANDLE_HW * 2} height={24} rx={3} fill="#5c6ac4" />
            <text x={selPxR} y={PAD.t + INNER_H / 2 + 4} textAnchor="middle" fill="white" fontSize={9} fontWeight="bold" style={{ pointerEvents: "none" }}>{selEnd}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ── CorrStrip ─────────────────────────────────────────────────────────────────
function CorrStrip({ corr, rhoE, regimeShifts, viewStart, viewEnd, playhead, showOverlays, rollingWindow }) {
  const H = 44, IH = H - 8;
  const viewLen = Math.max(1, viewEnd - viewStart);
  const toX = i => PAD.l + ((i - viewStart) / viewLen) * INNER_W;
  const toY = v => 4 + ((1 - (v + 1) / 2) * IH);

  let dCorr = "", dEma = "";
  for (let i = viewStart; i <= viewEnd; i++) {
    if (corr[i] !== null) {
      const x = toX(i).toFixed(1), y = toY(corr[i]).toFixed(1);
      dCorr += dCorr ? ` L${x},${y}` : `M${x},${y}`;
    }
    if (rhoE[i] !== null) {
      const x = toX(i).toFixed(1), y = toY(rhoE[i]).toFixed(1);
      dEma += dEma ? ` L${x},${y}` : `M${x},${y}`;
    }
  }

  const visShifts = showOverlays
    ? [...regimeShifts].filter(i => i >= viewStart && i <= viewEnd) : [];
  const phInView = playhead >= viewStart && playhead <= viewEnd;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: "#888", marginBottom: 1, display: "flex", gap: 10 }}>
        <span>{rollingWindow}-day rolling corr (selection)</span>
        <span style={{ color: "#c97c2e" }}>— EMA smoothed (α=0.2)</span>
      </div>
      <svg width={CW} height={H}
        style={{ display: "block", border: "1px solid #e1e3e5", borderRadius: 4, background: "#fafbfb" }}>
        <line x1={PAD.l} y1={toY(0)} x2={PAD.l + INNER_W} y2={toY(0)} stroke="#ddd" strokeWidth={1} />
        {[0.65, 0.25, -0.25].map(t => (
          <line key={t} x1={PAD.l} y1={toY(t)} x2={PAD.l + INNER_W} y2={toY(t)}
            stroke="#b8c0cc" strokeWidth={0.5} strokeDasharray="2,2" />
        ))}
        {visShifts.map(i => (
          <line key={i} x1={toX(i)} y1={4} x2={toX(i)} y2={4 + IH}
            stroke="#de3618" strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
        ))}
        {/* Raw corr (faint) */}
        <path d={dCorr} fill="none" stroke="#f0b070" strokeWidth="1" opacity="0.5" />
        {/* EMA (prominent) */}
        <path d={dEma} fill="none" stroke="#c97c2e" strokeWidth="1.5" />
        {phInView && (
          <line x1={toX(playhead)} y1={4} x2={toX(playhead)} y2={4 + IH} stroke="#ff6900" strokeWidth={2} />
        )}
        {phInView && rhoE[playhead] !== null && (
          <circle cx={toX(playhead)} cy={toY(rhoE[playhead])} r={3.5}
            fill="#ff6900" stroke="#fff" strokeWidth={1} />
        )}
      </svg>
    </div>
  );
}

// ── Styles / constants ────────────────────────────────────────────────────────
const btnSm = (bg, fg = "#fff") => ({
  padding: "4px 12px", background: bg, color: fg,
  border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600,
});
const MS_MIN  = 10, MS_MAX = 2000;
const logToMs = v  => Math.round(MS_MIN * Math.pow(MS_MAX / MS_MIN, v / 100));
const msToLog = ms => Math.round(Math.log(ms / MS_MIN) / Math.log(MS_MAX / MS_MIN) * 100);
const numInput = { width: 54, padding: "2px 6px", border: "1px solid #c9cccf", borderRadius: 3, fontSize: 12 };
const DEFAULT_WINDOW_SHORT = 7;
const DEFAULT_WINDOW_LONG = 14;
const DATASET_ID = "synthetic-180-v3";

function defaultRollingWindowForSelection(selectionLength) {
  return selectionLength < 40 ? DEFAULT_WINDOW_SHORT : DEFAULT_WINDOW_LONG;
}

const REGIONS = [
  { label: "A (correlated)",   start: 0,   end: 59  },
  { label: "B (uncorrelated)", start: 60,  end: 89  },
  { label: "C (lagged)",       start: 90,  end: 129 },
  { label: "D (shifted)",      start: 130, end: 179 },
];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Sonify() {
  const [selStart,  setSelStart]  = useState(0);
  const [selEnd,    setSelEnd]    = useState(TOTAL - 1);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd,   setViewEnd]   = useState(TOTAL - 1);
  const [step,      setStep]      = useState(0);
  const [playing,   setPlaying]   = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [loopSel,   setLoopSel]   = useState(true);
  const [msPerDay,  setMsPerDay]  = useState(500);
  const [rollingWindow, setRollingWindow] = useState(DEFAULT_WINDOW_SHORT);
  const [rollingWindowLocked, setRollingWindowLocked] = useState(false);
  const [showOverlays,  setShowOverlays]  = useState(true);
  const [chordStateDisplay, setChordStateDisplay] = useState('unison');
  const [renderMode, setRenderMode] = useState("deterministic");
  const [demoModeHint, setDemoModeHint] = useState("FREEFORM");
  const [aiPlan, setAiPlan] = useState(null);
  const [aiPlanLoading, setAiPlanLoading] = useState(false);
  const [aiPlanError, setAiPlanError] = useState("");
  const [planRefreshNonce, setPlanRefreshNonce] = useState(0);
  const [audioLayers, setAudioLayers] = useState({
    harmony: true, tension: false, echo: false, events: false,
  });

  const dataset = useMemo(() => generateData(), []);
  const globalShiftDay = useMemo(() => {
    const fullCorr = rollingCorr(dataset.x, dataset.y, DEFAULT_WINDOW_SHORT);
    const shifts = [...detectRegimeShifts(fullCorr, 0.4)];
    return shifts[0] ?? 61;
  }, [dataset]);
  const shortcuts = useMemo(() => ([
    { label: "Calibrate",  title: "Baseline correlated — day 5–25", ss: 5,  se: 25,  ms: 800,  w: 7, mode: "CALIBRATE" },
    { label: "Divergence", title: "Uncorrelated region — day 60–85", ss: 60, se: 85,  ms: 500,  w: 7, mode: "DIVERGENCE" },
    { label: "Lag",        title: "Lagged region — day 90–120", ss: 90, se: 120, ms: 900,  w: 7, mode: "LAG" },
    {
      label: "Shift",
      title: `Around regime shift marker — day ${Math.max(0, globalShiftDay - 6)}–${Math.min(TOTAL - 1, globalShiftDay + 6)}`,
      ss: Math.max(0, globalShiftDay - 6),
      se: Math.min(TOTAL - 1, globalShiftDay + 6),
      ms: 1200,
      w: 7,
      mode: "SHIFT",
    },
  ]), [globalShiftDay]);

  const selAnalytics = useMemo(() => {
    const sx = dataset.x.slice(selStart, selEnd + 1);
    const sy = dataset.y.slice(selStart, selEnd + 1);
    const w  = Math.min(rollingWindow, Math.max(2, sx.length - 1));
    const rc = rollingCorr(sx, sy, w);
    const rd = divergenceEnergy(sx, sy);
    const rl = detectLag(sx, sy, 7);

    // EMA-smoothed correlation: rhoE[t] = 0.8·rhoE[t-1] + 0.2·rc[t]
    const rhoESlice = new Array(sx.length).fill(null);
    let ema = 0, emaInit = false;
    for (let i = 0; i < sx.length; i++) {
      if (rc[i] === null) continue;
      ema = emaInit ? 0.8 * ema + 0.2 * rc[i] : rc[i];
      emaInit = true;
      rhoESlice[i] = ema;
    }

    const corr = new Array(TOTAL).fill(null);
    const divE = new Array(TOTAL).fill(0);
    const lags = new Array(TOTAL).fill(0);
    const rhoE = new Array(TOTAL).fill(null);
    for (let i = 0; i < sx.length; i++) {
      corr[selStart + i] = rc[i];
      divE[selStart + i] = rd[i];
      lags[selStart + i] = rl[i];
      rhoE[selStart + i] = rhoESlice[i];
    }
    return { corr, divE, lags, rhoE, shifts: detectRegimeShifts(corr, 0.4) };
  }, [selStart, selEnd, rollingWindow, dataset]);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const stepRef        = useRef(0);
  const msPerDayRef    = useRef(msPerDay);
  const selRef         = useRef({ start: selStart, end: selEnd });
  const loopRef        = useRef(loopSel);
  const isDraggingRef  = useRef(false);
  const isScrubbingRef = useRef(false);
  const wasPlayingRef  = useRef(false);
  const analyticsRef   = useRef(selAnalytics);
  const playingRef     = useRef(false);
  const engineRef      = useRef(null);
  const aiDebounceRef  = useRef(null);
  const aiAbortRef     = useRef(null);

  if (!engineRef.current) {
    engineRef.current = createSonificationAudioEngine({
      getAnalytics: () => analyticsRef.current,
      getSelection: () => selRef.current,
      getMsPerDay: () => msPerDayRef.current,
      getLoop: () => loopRef.current,
      getIsDragging: () => isDraggingRef.current,
      getIsScrubbing: () => isScrubbingRef.current,
      onStepChange: (nextStep) => {
        stepRef.current = nextStep;
        setStep(nextStep);
      },
      onPlayingChange: (nextPlaying) => {
        playingRef.current = nextPlaying;
        setPlaying(nextPlaying);
      },
      onChordStateChange: setChordStateDisplay,
      onActiveChange: setAudioReady,
    });
  }

  const audioEngine = engineRef.current;
  const activePlanMode = renderMode === "ai" && aiPlan ? "ai" : "deterministic";
  const planMarkers = useMemo(() => (
    (aiPlan?.markers ?? []).map((marker) => ({
      ...marker,
      step: selStart + marker.step,
    }))
  ), [aiPlan, selStart]);

  useEffect(() => { msPerDayRef.current = msPerDay; }, [msPerDay]);
  useEffect(() => { loopRef.current = loopSel; }, [loopSel]);
  useEffect(() => { analyticsRef.current = selAnalytics; }, [selAnalytics]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { audioEngine.setAiPlan(aiPlan); }, [aiPlan, audioEngine]);
  useEffect(() => { audioEngine.setRenderMode(activePlanMode); }, [activePlanMode, audioEngine]);
  useEffect(() => { audioEngine.setEnabledLayers(audioLayers); }, [audioEngine, audioLayers]);
  useEffect(() => {
    selRef.current = { start: selStart, end: selEnd };
    const clamped = Math.max(selStart, Math.min(selEnd, stepRef.current));
    audioEngine.setPlaybackIndex(clamped);
    const maxWindow = Math.max(2, Math.min(30, selEnd - selStart));
    if (rollingWindowLocked) {
      setRollingWindow(w => Math.min(w, maxWindow));
    } else {
      setRollingWindow(Math.min(defaultRollingWindowForSelection(selEnd - selStart + 1), maxWindow));
    }
  }, [audioEngine, rollingWindowLocked, selStart, selEnd]);

  useEffect(() => () => audioEngine.stop(), [audioEngine]);
  useEffect(() => () => {
    clearTimeout(aiDebounceRef.current);
    aiAbortRef.current?.abort();
  }, []);

  // ── seekTo ────────────────────────────────────────────────────────────────
  function seekTo(rawDay) {
    const day = Math.round(Math.max(0, Math.min(TOTAL - 1, rawDay)));
    const len = selEnd - selStart;
    let newSS = selStart, newSE = selEnd;
    if (day < selStart) {
      newSS = Math.max(0, day);
      newSE = Math.min(TOTAL - 1, newSS + len);
      setSelStart(newSS); setSelEnd(newSE);
    } else if (day > selEnd) {
      newSE = Math.min(TOTAL - 1, day);
      newSS = Math.max(0, newSE - len);
      setSelStart(newSS); setSelEnd(newSE);
    }
    const target = Math.max(newSS, Math.min(newSE, day));
    audioEngine.setPlaybackIndex(target);
  }

  function scheduleAiPlanGeneration() {
    clearTimeout(aiDebounceRef.current);
    aiAbortRef.current?.abort();
    setAiPlan(null);
    setAiPlanError("");
    setAiPlanLoading(true);

    aiDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      aiAbortRef.current = controller;

      try {
        const response = await fetch("/api/audio-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            datasetId: DATASET_ID,
            xSeries: dataset.x,
            ySeries: dataset.y,
            selectionStart: selStart,
            selectionEnd: selEnd,
            rollingWindow,
            msPerStep: msPerDay,
            demoModeHint,
          }),
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok || !payload?.ok || !payload?.plan) {
          throw new Error(payload?.error || "AI plan generation failed");
        }
        setAiPlan(payload.plan);
        setAiPlanError("");
      } catch (error) {
        if (error?.name === "AbortError") return;
        setAiPlan(null);
        setAiPlanError(error instanceof Error ? error.message : "AI plan generation failed");
      } finally {
        setAiPlanLoading(false);
      }
    }, 400);
  }

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (renderMode !== "ai") {
      clearTimeout(aiDebounceRef.current);
      aiAbortRef.current?.abort();
      setAiPlanLoading(false);
      return;
    }
    scheduleAiPlanGeneration();
  }, [renderMode, selStart, selEnd, rollingWindow, msPerDay, demoModeHint, planRefreshNonce]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // ── Play/stop button ──────────────────────────────────────────────────────
  function handlePlayStop() {
    if (playing) audioEngine.stop();
    else if (audioReady) audioEngine.resume();
    else audioEngine.start();
  }

  // ── Scrub callbacks ───────────────────────────────────────────────────────
  function onScrubStart() {
    isScrubbingRef.current = true;
    wasPlayingRef.current  = playingRef.current;
    setScrubbing(true);
    audioEngine.beginScrub();
  }
  function onScrubEnd() {
    isScrubbingRef.current = false;
    setScrubbing(false);
    audioEngine.endScrub(wasPlayingRef.current);
  }

  // ── Shortcut handler ──────────────────────────────────────────────────────
  function applyShortcut({ ss, se, ms, w, mode }) {
    setSelStart(ss); setSelEnd(se); setMsPerDay(ms);
    setViewStart(ss); setViewEnd(se);
    setRollingWindow(w);
    setRollingWindowLocked(true);
    setDemoModeHint(mode);
    audioEngine.setPlaybackIndex(ss);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const { corr, divE, lags, rhoE, shifts } = selAnalytics;
  const curCorr = corr[step];
  const curLag  = lags[step];
  const curDiv  = divE[step];
  const isShift = shifts.has(step);
  const selDays = selEnd - selStart + 1;
  const region  = REGIONS.find(r => step >= r.start && step <= r.end);

  const statusLabel = scrubbing ? "◎ Scrubbing"
    : playing ? "● Playing"
    : audioReady ? "⏸ Paused"
    : "— Stopped";
  const statusColor = scrubbing ? "#5c6ac4" : playing ? "#008060" : "#888";

  return (
    <div style={{ padding: "20px 24px", maxWidth: 750, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 3 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
          Relational Sonification — 180-day Demo
        </h2>
        <span style={{ fontSize: 12, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
      </div>
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 10px" }}>
        Deterministic synthetic dataset · No Shopify API
      </p>

      {/* Jump shortcuts */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#888", marginRight: 2 }}>Jump:</span>
        {shortcuts.map(s => (
          <button key={s.label} title={s.title} onClick={() => applyShortcut(s)}
            style={btnSm(s.label === "Calibrate" ? "#008060" : "#637381")}>
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#888", marginRight: 2 }}>Render:</span>
        <button
          onClick={() => setRenderMode("deterministic")}
          style={btnSm(renderMode === "deterministic" ? "#5c6ac4" : "#dfe3e8", renderMode === "deterministic" ? "#fff" : "#444")}
        >
          Deterministic mapping
        </button>
        <button
          onClick={() => setRenderMode("ai")}
          style={btnSm(renderMode === "ai" ? "#00848e" : "#dfe3e8", renderMode === "ai" ? "#fff" : "#444")}
        >
          AI Plan
        </button>
        <button
          onClick={() => setPlanRefreshNonce(n => n + 1)}
          disabled={renderMode !== "ai"}
          style={btnSm(renderMode === "ai" ? "#637381" : "#dfe3e8", renderMode === "ai" ? "#fff" : "#888")}
        >
          {aiPlanLoading ? "Generating…" : "Generate AI Plan"}
        </button>
        <span style={{ fontSize: 11, color: "#888" }}>Hint: {demoModeHint}</span>
      </div>

      {aiPlanError && (
        <div style={{
          marginBottom: 10,
          padding: "8px 10px",
          borderRadius: 4,
          background: "#fff4f4",
          border: "1px solid #de3618",
          color: "#9c2f19",
          fontSize: 12,
        }}>
          AI plan failed. Falling back to deterministic mapping. {aiPlanError}
        </div>
      )}

      {renderMode === "ai" && (
        <div style={{
          marginBottom: 10,
          padding: "10px 12px",
          borderRadius: 4,
          background: "#f7fbfc",
          border: "1px solid #d8e8ea",
        }}>
          <div style={{ fontSize: 11, color: "#555", fontWeight: 700, marginBottom: 4 }}>Plan Preview</div>
          <div style={{ fontSize: 12, color: "#444", marginBottom: 4 }}>
            <strong>{aiPlan?.caption ?? (aiPlanLoading ? "Generating AI plan…" : "No AI plan yet")}</strong>
          </div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
            Insight: <strong>{aiPlan?.primary_insight ?? "—"}</strong>
          </div>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>
            Markers: {(aiPlan?.markers ?? []).length ? aiPlan.markers.map(marker => `${marker.step}:${marker.label}`).join(" · ") : "—"}
          </div>
          <div style={{ fontSize: 11, color: "#666" }}>
            Segments: {(aiPlan?.audio_plan?.segments ?? []).length
              ? aiPlan.audio_plan.segments.map(segment => (
                `${segment.startStep}-${segment.endStep} ${segment.chord} t=${segment.tension.toFixed(2)} e=${segment.echo_ms}ms tick=${segment.tick ? "y" : "n"}`
              )).join(" · ")
              : "—"}
          </div>
        </div>
      )}

      {/* Zoom toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <button onClick={() => { setViewStart(selStart); setViewEnd(selEnd); }} style={btnSm("#5c6ac4")}>
          Zoom to selection
        </button>
        <button onClick={() => { setViewStart(0); setViewEnd(TOTAL - 1); }} style={btnSm("#637381")}>
          Reset zoom
        </button>
        <span style={{ fontSize: 11, color: "#aaa" }}>
          View: {viewStart}–{viewEnd} ({viewEnd - viewStart + 1}d)
        </span>
      </div>

      <BrushableChart
        xData={dataset.x} yData={dataset.y}
        divEnergy={divE}  regimeShifts={shifts}
        selStart={selStart} selEnd={selEnd}
        viewStart={viewStart} viewEnd={viewEnd}
        planMarkers={planMarkers}
        playhead={step} showOverlays={showOverlays} isScrubbing={scrubbing}
        onSelChange={(ns, ne) => { setSelStart(ns); setSelEnd(ne); setDemoModeHint("FREEFORM"); }}
        onViewChange={(vs, ve) => { setViewStart(Math.max(0, vs)); setViewEnd(Math.min(TOTAL - 1, ve)); }}
        onBrushDragStart={() => { isDraggingRef.current = true; }}
        onBrushDragEnd={()   => { isDraggingRef.current = false; }}
        onSeek={seekTo} onScrubStart={onScrubStart} onScrubEnd={onScrubEnd}
      />

      <CorrStrip
        corr={corr} rhoE={rhoE} regimeShifts={shifts}
        viewStart={viewStart} viewEnd={viewEnd}
        playhead={step} showOverlays={showOverlays} rollingWindow={rollingWindow}
      />

      {/* Status bar */}
      <div style={{
        fontSize: 12, color: "#444", padding: "7px 12px",
        background: "#f4f6f8", borderRadius: 4, marginBottom: 10,
        display: "flex", gap: 14, flexWrap: "wrap", lineHeight: 1.6,
        fontVariantNumeric: "tabular-nums",
        border: isShift ? "1px solid #de3618" : "1px solid transparent",
        transition: "border-color 0.3s",
      }}>
        <span>Day <strong style={{ color: "#ff6900" }}>{step + 1}</strong> / {TOTAL}</span>
        <span>Selected: <strong>Day {selStart}–{selEnd}</strong> ({selDays}d)</span>
        <span>Roll W: <strong>{rollingWindow}d</strong></span>
        <span>Region <strong>{region?.label ?? "—"}</strong></span>
        <span>Corr <strong style={{ color: curCorr === null ? "#aaa" : curCorr > 0.3 ? "#008060" : curCorr < -0.3 ? "#de3618" : "#444" }}>
          {curCorr !== null ? curCorr.toFixed(3) : "—"}
        </strong></span>
        <span>Chord <strong style={{ color: "#c97c2e" }}>{CHORD_NAMES[chordStateDisplay]}</strong></span>
        <span>Lag <strong>{curLag > 0 ? `+${curLag}` : curLag}d</strong></span>
        <span>Div <strong>{curDiv.toFixed(2)}</strong></span>
        {isShift && <span style={{ color: "#de3618", fontWeight: 700 }}>⚡ Regime shift</span>}
      </div>

      {/* Audio Layers */}
      <div style={{ marginBottom: 10, padding: "8px 12px", background: "#f9fafb",
        border: "1px solid #e1e3e5", borderRadius: 4 }}>
        <div style={{ fontSize: 11, color: "#555", fontWeight: 600, marginBottom: 6 }}>Audio Layers</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {[
            { key: "harmony",  label: "Harmony",  desc: "corr → interval",   alwaysOn: false },
            { key: "tension",  label: "Tension",  desc: "divergence → gain"  },
            { key: "echo",     label: "Echo",     desc: "lag ≥ 2d → delay"   },
            { key: "events",   label: "Events",   desc: "regime shift → tick" },
          ].map(({ key, label, desc }) => (
            <label key={key} style={{ fontSize: 12, color: "#444", display: "flex",
              alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox"
                checked={audioLayers[key]}
                onChange={e => setAudioLayers(l => ({ ...l, [key]: e.target.checked }))} />
              <strong style={{ color: key === "harmony" ? "#5c6ac4" : "#444" }}>{label}</strong>
              <span style={{ fontSize: 10, color: "#aaa" }}>{desc}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Playback controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <button onClick={handlePlayStop}
          style={{ padding: "8px 24px", fontSize: 14, fontWeight: 600,
            background: playing ? "#de3618" : "#008060",
            color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
          {playing ? "■  Stop" : audioReady ? "▶  Resume" : "▶  Play"}
        </button>

        <label style={{ fontSize: 13, color: "#444", display: "flex", alignItems: "center", gap: 7 }}>
          Speed
          <input type="range" min={0} max={100} step={1} value={msToLog(msPerDay)}
            onChange={e => setMsPerDay(logToMs(+e.target.value))} style={{ width: 110 }} />
          <strong style={{ minWidth: 52 }}>{msPerDay}ms</strong>
          <span style={{ color: "#aaa", fontSize: 11 }}>
            (~{((180 * msPerDay) / 1000).toFixed(1)}s/sweep)
          </span>
        </label>

        <label style={{ fontSize: 13, color: "#444", display: "flex", alignItems: "center", gap: 7 }}>
          Roll W
          <input type="range" min={7} max={Math.max(7, Math.min(30, selDays - 1))} step={1}
            value={rollingWindow}
            onChange={e => {
              setRollingWindow(+e.target.value);
              setRollingWindowLocked(true);
            }}
            style={{ width: 80 }} />
          <strong style={{ minWidth: 20 }}>{rollingWindow}</strong>
          {!rollingWindowLocked && <span style={{ color: "#aaa", fontSize: 11 }}>auto</span>}
        </label>

        <label style={{ fontSize: 13, color: "#444", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={loopSel} onChange={e => setLoopSel(e.target.checked)} />
          Loop
        </label>
        <label style={{ fontSize: 13, color: "#444", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={showOverlays} onChange={e => setShowOverlays(e.target.checked)} />
          Overlays
        </label>
      </div>

      {/* Fine-tune inputs */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, fontSize: 12, color: "#666" }}>
        <span>Start:</span>
        <input type="number" min={0} max={selEnd - MIN_SEL} value={selStart}
          onChange={e => { const v = +e.target.value; if (!isNaN(v)) { setSelStart(Math.max(0, Math.min(v, selEnd - MIN_SEL))); setDemoModeHint("FREEFORM"); } }}
          style={numInput} />
        <span>End:</span>
        <input type="number" min={selStart + MIN_SEL} max={TOTAL - 1} value={selEnd}
          onChange={e => { const v = +e.target.value; if (!isNaN(v)) { setSelEnd(Math.max(selStart + MIN_SEL, Math.min(v, TOTAL - 1))); setDemoModeHint("FREEFORM"); } }}
          style={numInput} />
        <span style={{ color: "#bbb" }}>fine-tune</span>
      </div>

      {/* Legend */}
      <div style={{ fontSize: 11, color: "#888", lineHeight: 1.9, borderTop: "1px solid #e1e3e5", paddingTop: 10 }}>
        <strong style={{ color: "#555" }}>Audio — Harmony layer</strong>{" "}
        (triangle oscillators, constant waveform){" · "}
        EMA-smoothed corr → chord updates at most every 2 steps with hysteresis{" · "}
        fifth (3:2) &gt; 0.65 · third (5:4) &gt; 0.25 · unison · tritone (sqrt(2)) &lt; −0.25<br />
        <strong style={{ color: "#555" }}>Visual</strong>{" — "}
        <span style={{ color: "#ff6900" }}>orange</span> = playhead{" · "}
        amber line = EMA corr{" · "}
        red dashed = regime shift{" · "}
        red fill = high divergence
      </div>
    </div>
  );
}
