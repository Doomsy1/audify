import test from "node:test";
import assert from "node:assert/strict";

import {
  buildToolTraceSeries,
  summarizeToolTrace,
} from "../toolTraceGraph.js";

test("summarizeToolTrace groups calls per tool and counts errors", () => {
  const summary = summarizeToolTrace([
    { tool: "metrics_summary", status: "ok" },
    { tool: "metrics_compare", status: "ok" },
    { tool: "metrics_summary", status: "ok" },
    { tool: "sonify_series", status: "error" },
  ]);

  assert.deepEqual(summary.byTool, {
    metrics_summary: 2,
    metrics_compare: 1,
    sonify_series: 1,
  });
  assert.equal(summary.total, 4);
  assert.equal(summary.failed, 1);
});

test("buildToolTraceSeries keeps only latest records and stable tool order", () => {
  const history = [
    { id: "q1", prompt: "one", tool_trace: [{ tool: "metrics_summary", status: "ok" }] },
    { id: "q2", prompt: "two", tool_trace: [{ tool: "metrics_compare", status: "ok" }] },
    { id: "q3", prompt: "three", tool_trace: [{ tool: "metrics_summary", status: "ok" }, { tool: "sonify_series", status: "ok" }] },
  ];

  const graph = buildToolTraceSeries(history, { limit: 2 });

  assert.deepEqual(graph.tools, ["metrics_compare", "metrics_summary", "sonify_series"]);
  assert.equal(graph.points.length, 2);
  assert.equal(graph.points[0].id, "q2");
  assert.equal(graph.points[1].id, "q3");
  assert.equal(graph.points[1].total, 2);
  assert.equal(graph.maxTotal, 2);
});
