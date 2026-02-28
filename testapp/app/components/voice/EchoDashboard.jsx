/**
 * EchoDashboard — displays traffic vs conversion rate using the same
 * normY / buildSvgPath / SVG method as app.sonify.jsx.
 *
 * - Traffic (orders) = blue line, left ear
 * - Conversion rate (rev ÷ orders) = teal line, right ear echo
 * - Orange playhead sweeps during audio; teal echo-head trails by lag_days
 */

import { useEffect, useRef, useState } from "react";

// ── Same helpers as app.sonify.jsx ─────────────────────────────────────────────
function normY(arr, H) {
  const vals = arr.filter((v) => v !== null && isFinite(v));
  if (!vals.length) return arr.map(() => H / 2);
  const min   = Math.min(...vals);
  const range = (Math.max(...vals) - min) || 1;
  return arr.map((v) => (v == null ? null : H - ((v - min) / range) * H));
}

function buildSvgPath(ys, lo, hi, toX, padT) {
  let d = "";
  for (let i = lo; i <= hi; i++) {
    if (ys[i] == null) continue;
    const px = toX(i);
    const py = padT + ys[i];
    d += d
      ? ` L${px.toFixed(1)},${py.toFixed(1)}`
      : `M${px.toFixed(1)},${py.toFixed(1)}`;
  }
  return d;
}

// ── Same constants as app.sonify.jsx ──────────────────────────────────────────
const CW      = 680;
const PAD     = { t: 10, b: 10, l: 4, r: 4 };
const INNER_W = CW - PAD.l - PAD.r;
const CHART_H = 150;
const INNER_H = CHART_H - PAD.t - PAD.b;

export function EchoDashboard({ charts, lagDays = 0, durationMs = 18000, isPlaying }) {
  const [playPct, setPlayPct] = useState(null);
  const startRef = useRef(null);
  const rafRef   = useRef(null);

  // Animate playhead with requestAnimationFrame — same pattern used in app.sonify.jsx
  // via the audioEngine's onStepChange callback.
  useEffect(() => {
    if (isPlaying) {
      startRef.current = Date.now();
      const tick = () => {
        const elapsed = Date.now() - startRef.current;
        const pct     = Math.min(1, elapsed / durationMs);
        setPlayPct(pct);
        if (pct < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          setPlayPct(null);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setPlayPct(null);
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying, durationMs]);

  if (!charts?.traffic?.length) return null;

  const n = charts.traffic.length;

  // Map data index → SVG x coordinate (same formula as app.sonify.jsx toX)
  const toX = (i) => PAD.l + (i / (n - 1)) * INNER_W;

  // Normalize both series to SVG pixel heights
  const rawTraffic = charts.traffic.map((p) => p.v);
  const rawConv    = charts.conversion_rate.map((p) => p.v);
  const nyTraffic  = normY(rawTraffic, INNER_H);
  const nyConv     = normY(rawConv,    INNER_H);

  const pathTraffic = buildSvgPath(nyTraffic, 0, n - 1, toX, PAD.t);
  const pathConv    = buildSvgPath(nyConv,    0, n - 1, toX, PAD.t);

  // Traffic playhead — orange, same as app.sonify.jsx
  const trafficStep = playPct !== null ? playPct * (n - 1) : null;
  const trafficPhX  = trafficStep !== null ? toX(trafficStep) : null;

  // Echo playhead — teal, trails by lag_days
  const echoStep = trafficStep !== null ? Math.max(0, trafficStep - lagDays) : null;
  const echoPhX  = echoStep !== null ? toX(echoStep) : null;

  // Circle y-positions at integer step for the playhead dot
  const stepI = trafficStep !== null ? Math.min(n - 1, Math.round(trafficStep)) : null;
  const echoI = echoStep   !== null ? Math.min(n - 1, Math.round(echoStep))    : null;
  const phYTraffic = stepI !== null && nyTraffic[stepI] != null ? PAD.t + nyTraffic[stepI] : null;
  const phYConv    = echoI !== null && nyConv[echoI]    != null ? PAD.t + nyConv[echoI]    : null;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Legend row — same style as app.sonify.jsx */}
      <div style={{
        fontSize: 11, color: "#555", marginBottom: 3,
        display: "flex", gap: 12, alignItems: "center",
      }}>
        <span><span style={{ color: "#5c6ac4" }}>●</span> Traffic (orders) — LEFT ear</span>
        <span><span style={{ color: "#47c1bf" }}>●</span> Conversion rate (rev ÷ orders) — RIGHT ear echo</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#aaa" }}>
          {lagDays > 0
            ? `echo trails traffic by ${lagDays} day${lagDays !== 1 ? "s" : ""}`
            : "no lag detected"}
        </span>
      </div>

      {/* Main chart — identical SVG structure to BrushableChart */}
      <svg
        width={CW} height={CHART_H}
        style={{
          display: "block",
          border: "1px solid #e1e3e5",
          borderRadius: 4,
          background: "#fafbfb",
          marginBottom: 6,
        }}
      >
        <defs>
          {/* Same glow filter as app.sonify.jsx */}
          <filter id="echo-ph-glow">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#ff6900" floodOpacity="0.65" />
          </filter>
          <filter id="echo-echo-glow">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#47c1bf" floodOpacity="0.65" />
          </filter>
        </defs>

        {/* Data lines — same stroke widths as app.sonify.jsx */}
        <path d={pathTraffic} fill="none" stroke="#5c6ac4" strokeWidth="1.5" />
        <path d={pathConv}    fill="none" stroke="#47c1bf" strokeWidth="1.5" />

        {/* Echo playhead — teal, slightly behind */}
        {echoPhX !== null && (
          <g style={{ pointerEvents: "none" }} filter="url(#echo-echo-glow)">
            <line
              x1={echoPhX} y1={PAD.t}
              x2={echoPhX} y2={PAD.t + INNER_H}
              stroke="#47c1bf" strokeWidth={2} opacity={0.75}
            />
            {phYConv !== null && (
              <circle cx={echoPhX} cy={phYConv} r={4.5} fill="#47c1bf" stroke="#fff" strokeWidth={1.5} />
            )}
          </g>
        )}

        {/* Traffic playhead — orange, same as app.sonify.jsx */}
        {trafficPhX !== null && (
          <g style={{ pointerEvents: "none" }} filter="url(#echo-ph-glow)">
            <line
              x1={trafficPhX} y1={PAD.t}
              x2={trafficPhX} y2={PAD.t + INNER_H}
              stroke="#ff6900" strokeWidth={2}
            />
            {phYTraffic !== null && (
              <circle cx={trafficPhX} cy={phYTraffic} r={4.5} fill="#5c6ac4" stroke="#fff" strokeWidth={1.5} />
            )}
            {/* Day label badge — same as app.sonify.jsx */}
            <rect
              x={trafficPhX - 14} y={PAD.t - 1}
              width={28} height={13}
              rx={3} fill="#ff6900" opacity={0.9}
            />
            <text
              x={trafficPhX} y={PAD.t + 9}
              textAnchor="middle" fill="white"
              fontSize={8} fontWeight="bold"
            >
              {stepI !== null ? stepI + 1 : ""}
            </text>
          </g>
        )}
      </svg>

      {/* Footer legend strip — matches Python legend_ax.text in monospace */}
      <div style={{
        fontSize: 11, color: "#888", lineHeight: 1.9,
        borderTop: "1px solid #e1e3e5", paddingTop: 8,
        fontVariantNumeric: "tabular-nums",
      }}>
        <span style={{ color: "#5c6ac4", fontWeight: 600 }}>LEFT</span>
        {" = traffic · organ pad · pitch rises with orders     "}
        <span style={{ color: "#47c1bf", fontWeight: 600 }}>RIGHT</span>
        {` = revenue echo · chorus + reverb · arrives ${lagDays} day${lagDays !== 1 ? "s" : ""} later     `}
        <span style={{ color: "#ff6900" }}>orange</span>
        {" = traffic playhead · "}
        <span style={{ color: "#47c1bf" }}>teal</span>
        {" = echo playhead (trails by lag)"}
      </div>
    </div>
  );
}
