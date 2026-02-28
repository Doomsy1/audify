export const FEATURE_VERSION = "audio-plan-v1";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values, avg = mean(values)) {
  if (!values.length) return 0;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[idx];
}

function zScore(values) {
  const avg = mean(values);
  const sigma = std(values, avg) || 1;
  return values.map((value) => (value - avg) / sigma);
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
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

function rollingCorr(x, y, w) {
  const window = Math.max(2, Math.min(w, x.length));
  return x.map((_, idx) => (
    idx < window - 1
      ? null
      : pearson(x.slice(idx - window + 1, idx + 1), y.slice(idx - window + 1, idx + 1))
  ));
}

function ema(values, alpha = 0.2) {
  const out = new Array(values.length).fill(null);
  let seeded = false;
  let current = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null || !Number.isFinite(value)) continue;
    current = seeded ? ((1 - alpha) * current) + (alpha * value) : value;
    seeded = true;
    out[i] = current;
  }
  return out;
}

function topIndices(values, count) {
  return values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count)
    .map((entry) => entry.index)
    .sort((a, b) => a - b);
}

function lagEstimate(x, y, maxLag) {
  const candidates = [];
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const ax = [];
    const ay = [];
    for (let i = 0; i < x.length; i += 1) {
      const j = i + lag;
      if (j < 0 || j >= y.length) continue;
      ax.push(x[i]);
      ay.push(y[j]);
    }
    if (ax.length < 4) continue;
    candidates.push({ lag, corr: pearson(ax, ay) });
  }

  if (!candidates.length) {
    return { bestLagDays: 0, confidence: 0, corrAtBestLag: 0 };
  }

  candidates.sort((a, b) => b.corr - a.corr);
  const best = candidates[0];
  const second = candidates[1] ?? { corr: best.corr };
  const gap = Math.max(0, best.corr - second.corr);
  const confidence = clamp(gap / Math.max(0.05, Math.abs(best.corr) + 0.05), 0, 1);

  return {
    bestLagDays: best.lag,
    confidence,
    corrAtBestLag: best.corr,
  };
}

function uniqueTopChangeDays(values, threshold, count) {
  const ranked = values
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value > threshold)
    .sort((a, b) => b.value - a.value);
  const picked = [];
  for (const entry of ranked) {
    if (picked.some((idx) => Math.abs(idx - entry.index) <= 2)) continue;
    picked.push(entry.index);
    if (picked.length >= count) break;
  }
  return picked.sort((a, b) => a - b);
}

export function computeAudioPlanFeatures({
  xSeries,
  ySeries,
  selectionStart,
  selectionEnd,
  rollingWindow,
  msPerStep,
  demoModeHint,
}) {
  const start = clamp(selectionStart, 0, xSeries.length - 1);
  const end = clamp(selectionEnd, start, xSeries.length - 1);
  const x = xSeries.slice(start, end + 1);
  const y = ySeries.slice(start, end + 1);
  const length = x.length;
  const window = Math.max(2, Math.min(rollingWindow, length));

  const rho = rollingCorr(x, y, window);
  const rhoE = ema(rho, 0.2);
  const rhoValues = rho.filter((value) => value != null);
  const rhoEValues = rhoE.filter((value) => value != null);

  const zx = zScore(x);
  const zy = zScore(y);
  const divergence = zx.map((value, index) => Math.abs(value - zy[index]));
  const divergenceMean = mean(divergence);
  const divergenceStd = std(divergence, divergenceMean);
  const divergenceP90 = percentile(divergence, 0.9);
  const spikeThreshold = Math.max(divergenceP90, divergenceMean + (1.5 * divergenceStd));
  const spikeDays = topIndices(divergence, Math.min(2, divergence.length));

  const deltaRhoE = rhoE.map((value, index) => {
    if (index === 0 || value == null || rhoE[index - 1] == null) return 0;
    return Math.abs(value - rhoE[index - 1]);
  });
  const smoothedDelta = ema(deltaRhoE, 0.35).map((value) => Math.abs(value ?? 0));
  const corrChangeDays = uniqueTopChangeDays(smoothedDelta, 0.08, 2);

  const lag = lagEstimate(x, y, 7);
  const rhoEFirst = rhoEValues[0] ?? 0;
  const rhoELast = rhoEValues[rhoEValues.length - 1] ?? rhoEFirst;

  return {
    featureVersion: FEATURE_VERSION,
    demoModeHint,
    seriesLength: length,
    selection: {
      startDay: start,
      endDay: end,
      lengthDays: length,
      rollingWindow: window,
      msPerStep,
    },
    correlation: {
      mean: mean(rhoValues),
      min: rhoValues.length ? Math.min(...rhoValues) : 0,
      max: rhoValues.length ? Math.max(...rhoValues) : 0,
      std: std(rhoValues),
      slope: length > 1 ? (rhoELast - rhoEFirst) / (length - 1) : 0,
      emaMean: mean(rhoEValues),
      rho,
      rhoE,
    },
    divergence: {
      mean: divergenceMean,
      max: divergence.length ? Math.max(...divergence) : 0,
      p90: divergenceP90,
      spikeCount: divergence.filter((value) => value > spikeThreshold).length,
      spikeDays,
      series: divergence,
    },
    lag,
    changePoints: {
      corrChangeDays,
      regimeShiftDays: corrChangeDays,
    },
    constraints: {
      maxSegments: 3,
      minSegmentLength: 3,
      maxTicks: 2,
      echoMinMs: 120,
      echoMaxMs: 220,
    },
  };
}
