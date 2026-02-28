import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSeriesPoints,
  resolvePlayheadIndex,
} from "../timeseriesChart.js";

test("normalizeSeriesPoints returns bounded normalized values", () => {
  const points = normalizeSeriesPoints([
    { t: "a", v: 10 },
    { t: "b", v: 20 },
    { t: "c", v: 30 },
  ]);

  assert.equal(points.length, 3);
  assert.equal(points[0].x, 0);
  assert.equal(points[2].x, 1);
  assert.equal(points[0].y, 0);
  assert.equal(points[2].y, 1);
});

test("resolvePlayheadIndex maps progress to nearest point", () => {
  assert.equal(resolvePlayheadIndex(10, 0), 0);
  assert.equal(resolvePlayheadIndex(10, 0.5), 5);
  assert.equal(resolvePlayheadIndex(10, 1), 9);
});
