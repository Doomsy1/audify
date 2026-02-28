import {
  buildMemoryKey,
  normalizeAgentRequest,
} from "../contracts/agent";
import { getAgentMemory, updateAgentMemory } from "./memory.server";
import { getBackboardSettings, maybeRefineAgentResponse } from "./backboardAgent.server";
import { runAgentTool } from "./toolRegistry.server";
import { synthesizeSpeechClip } from "../tts/elevenlabs.server";

function parseIntent(utterance) {
  const text = utterance.toLowerCase();

  if (text.includes("again slower") || (text.includes("slower") && text.includes("play"))) {
    return "replay_slower";
  }
  if (
    text.includes("echo") ||
    text.includes("lag") ||
    text.includes("dashboard") ||
    (text.includes("traffic") && text.includes("revenue"))
  ) {
    return "echo";
  }
  if (text.includes("compare") || text.includes("vs") || text.includes("versus")) {
    return "compare";
  }
  if (text.includes("spike") || text.includes("dip") || text.includes("what caused")) {
    return "spike_cause";
  }
  if (text.includes("last 7") || (text.includes("play") && text.includes("trend"))) {
    return "trend";
  }
  return "summary";
}

function buildToolPlan(intent, memory, requestBody) {
  const range = requestBody.overrides.range ?? memory.default_range;
  const metric = requestBody.overrides.metric ?? memory.last_metric;
  const speed = requestBody.overrides.sonify_speed ?? memory.sonify_speed;
  const tz = requestBody.context.tz || memory.tz;

  switch (intent) {
    case "echo":
      return [
        {
          tool: "sonify_dashboard",
          args: { range, tz, duration_ms: 18000, ticks: true },
        },
      ];
    case "compare":
      return [
        {
          tool: "metrics_compare",
          args: { range, compare_to: "yesterday", tz },
        },
        {
          tool: "metrics_timeseries",
          args: { metric, range: "last_7d", bucket: "day", tz },
        },
        {
          tool: "sonify_series",
          args: {
            seriesFrom: "metrics_timeseries",
            mapping: {
              preset: "trend_v1",
              duration_ms: 2800,
              speed,
              normalize: "minmax",
            },
          },
        },
      ];
    case "trend":
      return [
        {
          tool: "metrics_timeseries",
          args: { metric, range: "last_7d", bucket: "day", tz },
        },
        {
          tool: "sonify_series",
          args: {
            seriesFrom: "metrics_timeseries",
            mapping: {
              preset: "trend_v1",
              duration_ms: 2800,
              speed,
              normalize: "minmax",
            },
          },
        },
      ];
    case "replay_slower":
      return [
        {
          tool: "metrics_timeseries",
          args: { metric, range: "last_7d", bucket: "day", tz },
        },
        {
          tool: "sonify_series",
          args: {
            seriesFrom: "metrics_timeseries",
            mapping: {
              preset: "trend_v1",
              duration_ms: 3200,
              speed: Math.max(0.6, speed * 0.75),
              normalize: "minmax",
            },
          },
        },
      ];
    case "spike_cause":
      return [
        {
          tool: "metrics_timeseries",
          args: { metric, range: "last_30d", bucket: "day", tz },
        },
        {
          tool: "metrics_anomalies",
          args: { metric, range: "last_30d", bucket: "day", tz },
        },
        {
          tool: "metrics_breakdown",
          args: { metric: "revenue", range: "last_7d", by: "product", limit: 3, tz },
        },
        {
          tool: "sonify_series",
          args: {
            seriesFrom: "metrics_timeseries",
            mapping: {
              preset: "trend_v1",
              duration_ms: 2600,
              speed,
              normalize: "zscore",
            },
          },
        },
      ];
    case "summary":
    default:
      return [
        {
          tool: "metrics_summary",
          args: { range, tz },
        },
        {
          tool: "metrics_compare",
          args: { range, compare_to: "yesterday", tz },
        },
        {
          tool: "metrics_timeseries",
          args: { metric, range: "last_7d", bucket: "day", tz },
        },
        {
          tool: "sonify_series",
          args: {
            seriesFrom: "metrics_timeseries",
            mapping: {
              preset: "trend_v1",
              duration_ms: 2800,
              speed,
              normalize: "minmax",
            },
          },
        },
      ];
  }
}

async function executePlan(plan, toolContext) {
  const toolTrace = [];
  const results = new Map();

  for (const step of plan) {
    const args = { ...step.args };

    if (step.tool === "sonify_series" && step.args.seriesFrom) {
      args.series = results.get(step.args.seriesFrom);
    }

    const result = await runAgentTool(step.tool, args, toolContext);
    results.set(step.tool, result.data);
    toolTrace.push({
      tool: step.tool,
      args,
      status: "ok",
    });
  }

  return { results, toolTrace };
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value ?? 0);
}

function formatPct(value) {
  const rounded = Math.round((value ?? 0) * 10) / 10;
  const prefix = rounded > 0 ? "+" : "";
  return `${prefix}${rounded}%`;
}

function buildDeterministicResponse({ intent, memory, requestBody, results }) {
  const compare = results.get("metrics_compare");
  const summary = results.get("metrics_summary") ?? compare?.base;
  const series = results.get("metrics_timeseries");
  const anomalies = results.get("metrics_anomalies");
  const breakdown = results.get("metrics_breakdown");
  const listenMode = requestBody.context.listen_mode || memory.listen_mode;
  const metric = requestBody.overrides.metric ?? memory.last_metric;

  if (intent === "echo") {
    const dashboard = results.get("sonify_dashboard");
    const lag = dashboard?.lag_days ?? 1;
    return {
      spoken: `Traffic vs revenue echo. Revenue arrives ${lag} day${lag !== 1 ? "s" : ""} later.`,
      display: {
        bullets: [
          `LEFT = traffic`,
          `RIGHT = revenue echo, delayed ${lag} day${lag !== 1 ? "s" : ""}`,
          `Louder echo = higher conversion rate`,
        ],
        suggested_questions: [
          "What caused the spike?",
          "Show me the last 7 days trend",
        ],
      },
    };
  }

  if (intent === "replay_slower") {
    return {
      spoken: listenMode
        ? `Replaying the ${metric} trend slower now.`
        : `Replaying the last 7 days of ${metric} more slowly. Higher notes still mean higher ${metric}.`,
      display: {
        bullets: [
          `Metric: ${metric}`,
          "Playback speed reduced for easier listening",
        ],
        suggested_questions: [
          "What caused the spike?",
          "Compare today to yesterday",
        ],
      },
    };
  }

  if (intent === "trend") {
    return {
      spoken: listenMode
        ? `Playing the last 7 days of ${metric}. Higher notes mean higher ${metric}.`
        : `Here is the last 7 days of ${metric}. Higher notes mean higher ${metric}, and larger jumps indicate bigger changes.`,
      display: {
        bullets: [
          `Metric: ${metric}`,
          `${series?.points?.length ?? 0} points in the trend clip`,
        ],
        suggested_questions: [
          "Play that trend again slower",
          "Compare today to yesterday",
        ],
      },
    };
  }

  if (intent === "spike_cause") {
    const anomaly = anomalies?.anomalies?.[0];
    const topProduct = breakdown?.rows?.[0];
    return {
      spoken: listenMode
        ? `There is a clear ${metric} spike. I will play the anomaly-focused clip now.`
        : `The largest recent spike was on ${formatDate(anomaly?.t)}. The likely driver was ${topProduct?.key ?? "your top product"}, contributing ${formatCurrency(topProduct?.value ?? 0)}. I will play the anomaly-focused trend now.`,
      display: {
        bullets: [
          anomaly
            ? `Spike: ${formatDate(anomaly.t)} (${formatPct(anomaly.z * 100 / 100)} z-score)`
            : "No major anomaly detected in the selected window",
          topProduct
            ? `Top product around the spike: ${topProduct.key}`
            : "Top product unavailable",
        ],
        suggested_questions: [
          "Play that trend again slower",
          "How are we doing today?",
        ],
      },
    };
  }

  if (intent === "compare") {
    return {
      spoken: listenMode
        ? `${formatCurrency(compare?.base?.revenue ?? 0)} today. ${formatPct(compare?.deltas?.revenue_pct ?? 0)} versus yesterday.`
        : `Today revenue is ${formatCurrency(compare?.base?.revenue ?? 0)} from ${compare?.base?.orders ?? 0} orders. That is ${formatPct(compare?.deltas?.revenue_pct ?? 0)} versus yesterday. I will play the last 7 days of ${metric} next.`,
      display: {
        bullets: [
          `Revenue: ${formatCurrency(compare?.base?.revenue ?? 0)} (${formatPct(compare?.deltas?.revenue_pct ?? 0)} vs yesterday)`,
          `Orders: ${compare?.base?.orders ?? 0} (${formatPct(compare?.deltas?.orders_pct ?? 0)} vs yesterday)`,
          `AOV: ${formatCurrency(compare?.base?.aov ?? 0)} (${formatPct(compare?.deltas?.aov_pct ?? 0)} vs yesterday)`,
        ],
        suggested_questions: [
          "Play that trend again slower",
          "What caused the spike?",
        ],
      },
    };
  }

  return {
    spoken: listenMode
      ? `${formatCurrency(summary?.revenue ?? 0)} today from ${summary?.orders ?? 0} orders. ${formatPct(compare?.deltas?.revenue_pct ?? 0)} versus yesterday.`
      : `Today revenue is ${formatCurrency(summary?.revenue ?? 0)} from ${summary?.orders ?? 0} orders. That is ${formatPct(compare?.deltas?.revenue_pct ?? 0)} versus yesterday. I will play the last 7 days of ${metric} next. Higher notes mean higher ${metric}.`,
    display: {
      bullets: [
        `Revenue: ${formatCurrency(summary?.revenue ?? 0)} (${formatPct(compare?.deltas?.revenue_pct ?? 0)} vs yesterday)`,
        `Orders: ${summary?.orders ?? 0} (${formatPct(compare?.deltas?.orders_pct ?? 0)} vs yesterday)`,
        `AOV: ${formatCurrency(summary?.aov ?? 0)} (${formatPct(compare?.deltas?.aov_pct ?? 0)} vs yesterday)`,
      ],
      suggested_questions: [
        "Play that trend again slower",
        "What caused the spike?",
      ],
    },
  };
}

function formatDate(isoString) {
  if (!isoString) return "the selected period";
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function sanitizeRefinedResponse(refined, fallback) {
  if (!refined || typeof refined !== "object") return fallback;
  const spoken = typeof refined.spoken === "string" && refined.spoken.trim()
    ? refined.spoken.trim()
    : fallback.spoken;
  const display = refined.display && typeof refined.display === "object" ? refined.display : {};
  const bullets = Array.isArray(display.bullets) && display.bullets.length
    ? display.bullets.filter((entry) => typeof entry === "string").slice(0, 3)
    : fallback.display.bullets;
  const suggested = Array.isArray(display.suggested_questions) && display.suggested_questions.length
    ? display.suggested_questions.filter((entry) => typeof entry === "string").slice(0, 2)
    : fallback.display.suggested_questions;

  return {
    spoken,
    display: {
      bullets,
      suggested_questions: suggested,
    },
  };
}

function shortenSpokenResponse(spoken, maxWords = 22) {
  if (!spoken || typeof spoken !== "string") {
    return "";
  }

  const words = spoken.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return spoken.trim();
  }

  return `${words.slice(0, maxWords).join(" ")}...`;
}

function buildAudioArray(ttsClip, sonification) {
  const audio = [];

  if (ttsClip?.audioUrl) {
    audio.push({
      type: "tts",
      label: "Agent response",
      audio_url: ttsClip.audioUrl,
    });
  }

  if (sonification?.audio_url) {
    audio.push({
      type: "sonification",
      label: "Revenue trend",
      audio_url: sonification.audio_url,
    });
  }

  return audio;
}

export async function respondToAgentRequest({ payload, shop, accessToken }) {
  const requestBody = normalizeAgentRequest(payload);
  const backboard = getBackboardSettings();
  const memoryKey = buildMemoryKey({
    shop,
    sessionId: requestBody.context.session_id,
  });
  const memory = getAgentMemory(memoryKey);
  const intent = parseIntent(requestBody.utterance);
  const plan = buildToolPlan(intent, memory, requestBody);
  const { results, toolTrace } = await executePlan(plan, {
    shop,
    accessToken,
  });
  const fallbackResponse = buildDeterministicResponse({
    intent,
    memory,
    requestBody,
    results,
  });

  let displayPayload = fallbackResponse;
  let refinedWithBackboard = false;
  try {
    const refined = await maybeRefineAgentResponse({
      utterance: requestBody.utterance,
      intent,
      listen_mode: requestBody.context.listen_mode || memory.listen_mode,
      tool_results: Object.fromEntries(results.entries()),
      fallback: fallbackResponse,
    });
    refinedWithBackboard = Boolean(refined);
    displayPayload = sanitizeRefinedResponse(refined, fallbackResponse);
  } catch (_) {
    displayPayload = fallbackResponse;
  }

  const maxSpokenWords = (requestBody.context.listen_mode || memory.listen_mode) ? 12 : 22;
  const conciseSpoken = shortenSpokenResponse(displayPayload.spoken, maxSpokenWords);

  const ttsClip = await synthesizeSpeechClip({
    text: conciseSpoken,
  });

  // For the echo intent the Python popup owns all audio and visuals —
  // only keep TTS so the web tab just speaks the intro and stops.
  const sonification = intent === "echo"
    ? null
    : (results.get("sonify_series") ?? results.get("sonify_dashboard"));
  const timeseries = results.get("metrics_timeseries");
  const dashboardResult = intent === "echo" ? null : results.get("sonify_dashboard");
  const charts = dashboardResult?.chart_data ?? null;

  const nextSpeed = intent === "replay_slower"
    ? Math.max(0.6, (requestBody.overrides.sonify_speed ?? memory.sonify_speed) * 0.75)
    : (requestBody.overrides.sonify_speed ?? memory.sonify_speed);

  updateAgentMemory(memoryKey, {
    default_range: requestBody.overrides.range ?? memory.default_range,
    last_metric: requestBody.overrides.metric ?? memory.last_metric,
    tz: requestBody.context.tz || memory.tz,
    listen_mode: requestBody.context.listen_mode,
    sonify_speed: nextSpeed,
    verbosity: requestBody.overrides.verbosity ?? memory.verbosity,
  });

  return {
    spoken: conciseSpoken,
    display: displayPayload.display,
    audio: buildAudioArray(ttsClip, sonification),
    chart: {
      series: timeseries ?? null,
    },
    tool_trace: toolTrace,
    meta: {
      backboard: {
        attempted: backboard.configured,
        refined: refinedWithBackboard,
      },
    },
    ...(charts ? {
      charts,
      lag_days: dashboardResult.lag_days ?? 0,
      audio_duration_ms: dashboardResult.meta?.duration_ms ?? 18000,
    } : {}),
  };
}
