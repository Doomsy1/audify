function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, toNumber(value)));
}

export function compactSeriesValues(values = [], factor = 1) {
  if (!Array.isArray(values) || !values.length) {
    return [];
  }
  const safeFactor = Math.max(1, Math.floor(toNumber(factor) || 1));
  if (safeFactor === 1) {
    return values.map((value) => toNumber(value));
  }

  const compacted = [];
  for (let i = 0; i < values.length; i += safeFactor) {
    const chunk = values.slice(i, i + safeFactor).map((value) => toNumber(value));
    const sum = chunk.reduce((total, value) => total + value, 0);
    compacted.push(sum / Math.max(1, chunk.length));
  }
  return compacted;
}

export function normalizeSeriesPoints(points = []) {
  if (!Array.isArray(points) || !points.length) {
    return [];
  }

  const values = points.map((point) => toNumber(point?.v));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;
  const lengthDivisor = Math.max(1, points.length - 1);

  return points.map((point, index) => ({
    t: point?.t ?? String(index),
    v: toNumber(point?.v),
    x: index / lengthDivisor,
    y: (toNumber(point?.v) - minValue) / valueRange,
  }));
}

export function resolvePlayheadIndex(pointCount, progress) {
  if (!Number.isFinite(pointCount) || pointCount <= 0) {
    return 0;
  }
  if (pointCount === 1) {
    return 0;
  }

  const normalized = clamp01(progress);
  return Math.round(normalized * (pointCount - 1));
}
