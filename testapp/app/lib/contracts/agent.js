const ALLOWED_RANGES = new Set([
  "today",
  "yesterday",
  "last_7d",
  "last_30d",
  "custom",
]);

const ALLOWED_METRICS = new Set(["revenue", "orders", "aov"]);
const ALLOWED_VERBOSITY = new Set(["short", "medium", "detailed"]);

export const DEFAULT_AGENT_MEMORY = Object.freeze({
  default_range: "today",
  last_metric: "revenue",
  tz: "UTC",
  listen_mode: false,
  sonify_speed: 1,
  verbosity: "short",
});

export function normalizeAgentRequest(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const context = body.context && typeof body.context === "object" ? body.context : {};
  const overrides = body.overrides && typeof body.overrides === "object" ? body.overrides : {};

  const utterance = typeof body.utterance === "string" ? body.utterance.trim() : "";
  if (!utterance) {
    throw new Error("utterance is required");
  }

  const normalized = {
    utterance,
    context: {
      tz: typeof context.tz === "string" && context.tz.trim() ? context.tz.trim() : DEFAULT_AGENT_MEMORY.tz,
      listen_mode: Boolean(context.listen_mode),
      client_request_id: typeof context.client_request_id === "string" ? context.client_request_id : "",
      session_id: typeof context.session_id === "string" && context.session_id.trim()
        ? context.session_id.trim()
        : "",
    },
    overrides: {},
  };

  if (typeof overrides.range === "string" && ALLOWED_RANGES.has(overrides.range)) {
    normalized.overrides.range = overrides.range;
  }
  if (typeof overrides.metric === "string" && ALLOWED_METRICS.has(overrides.metric)) {
    normalized.overrides.metric = overrides.metric;
  }
  if (typeof overrides.sonify_speed === "number" && Number.isFinite(overrides.sonify_speed)) {
    normalized.overrides.sonify_speed = clamp(overrides.sonify_speed, 0.5, 1.5);
  }
  if (typeof overrides.verbosity === "string" && ALLOWED_VERBOSITY.has(overrides.verbosity)) {
    normalized.overrides.verbosity = overrides.verbosity;
  }

  return normalized;
}

export function buildMemoryKey({ shop, sessionId }) {
  if (sessionId) return `session:${sessionId}`;
  if (shop) return `shop:${shop}`;
  return "anonymous";
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
