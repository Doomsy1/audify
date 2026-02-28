const DEFAULT_LIMIT = 8;

export const TOOL_COLORS = {
  metrics_summary: "#1f6feb",
  metrics_compare: "#0e8a5f",
  metrics_timeseries: "#d29922",
  metrics_anomalies: "#8b5cf6",
  metrics_breakdown: "#db6d28",
  sonify_series: "#b62324",
};

function sanitizeToolName(tool) {
  if (!tool || typeof tool !== "string") {
    return "unknown_tool";
  }
  return tool;
}

export function summarizeToolTrace(toolTrace = []) {
  const summary = {
    total: 0,
    failed: 0,
    byTool: {},
  };

  for (const entry of toolTrace) {
    const tool = sanitizeToolName(entry?.tool);
    summary.byTool[tool] = (summary.byTool[tool] ?? 0) + 1;
    summary.total += 1;
    if (entry?.status && entry.status !== "ok") {
      summary.failed += 1;
    }
  }

  return summary;
}

export function buildToolTraceSeries(history = [], { limit = DEFAULT_LIMIT } = {}) {
  const stableLimit = Math.max(1, Number(limit) || DEFAULT_LIMIT);
  const points = history.slice(-stableLimit).map((item, index) => {
    const summary = summarizeToolTrace(item?.tool_trace ?? []);

    return {
      id: item?.id ?? `interaction_${index + 1}`,
      prompt: item?.prompt ?? "",
      total: summary.total,
      failed: summary.failed,
      byTool: summary.byTool,
    };
  });

  const toolSet = new Set();
  for (const point of points) {
    for (const tool of Object.keys(point.byTool)) {
      toolSet.add(tool);
    }
  }

  const tools = [...toolSet].sort((a, b) => a.localeCompare(b));
  const maxTotal = points.reduce((acc, point) => Math.max(acc, point.total), 0);

  return {
    points,
    tools,
    maxTotal,
  };
}
