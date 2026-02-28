const ALLOWED_INSIGHTS = new Set([
  "ALIGNMENT",
  "DIVERGENCE",
  "LAG",
  "REGIME_SHIFT",
  "NO_CLEAR_SIGNAL",
]);

const ALLOWED_CHORDS = new Set(["fifth", "third", "unison", "tritone"]);
const ALLOWED_MARKER_TYPES = new Set(["change", "spike", "lag", "shift"]);

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value) {
  return typeof value === "string" ? value : null;
}

function asBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function fail(message) {
  const error = new Error(message);
  error.name = "AudioPlanValidationError";
  throw error;
}

export function validateAudioPlanResponse(value, context) {
  const { stepCount, lag } = context;
  if (!value || typeof value !== "object") fail("Plan payload must be an object");

  const caption = asString(value.caption);
  const primaryInsight = asString(value.primary_insight);
  const audioPlan = value.audio_plan;
  const markers = Array.isArray(value.markers) ? value.markers : null;
  const debug = value.debug;

  if (!caption) fail("caption is required");
  if (!ALLOWED_INSIGHTS.has(primaryInsight)) fail("primary_insight is invalid");
  if (!audioPlan || typeof audioPlan !== "object") fail("audio_plan is required");
  if (!markers) fail("markers must be an array");
  if (!debug || typeof debug !== "object") fail("debug is required");

  if (audioPlan.base_freq_hz !== 220) fail("base_freq_hz must be 220");
  if (audioPlan.waveform !== "triangle") fail("waveform must be triangle");
  if (!Array.isArray(audioPlan.segments)) fail("segments must be an array");
  if (audioPlan.segments.length === 0 || audioPlan.segments.length > 3) fail("segments length invalid");

  const normalizedSegments = [];
  let expectedStart = 0;
  let tickCount = 0;

  for (const segment of audioPlan.segments) {
    if (!segment || typeof segment !== "object") fail("segment must be an object");
    const startStep = asNumber(segment.startStep);
    const endStep = asNumber(segment.endStep);
    const chord = asString(segment.chord);
    const tension = asNumber(segment.tension);
    const echoMs = asNumber(segment.echo_ms);
    const tick = asBoolean(segment.tick);
    const why = asString(segment.why);

    if (startStep == null || endStep == null) fail("segment bounds required");
    if (!Number.isInteger(startStep) || !Number.isInteger(endStep)) fail("segment bounds must be integers");
    if (startStep !== expectedStart) fail("segments must be contiguous");
    if (endStep < startStep) fail("segment end must be >= start");
    if ((endStep - startStep + 1) < 3) fail("segment length must be >= 3");
    if (endStep >= stepCount) fail("segment end exceeds range");
    if (!ALLOWED_CHORDS.has(chord)) fail("segment chord invalid");
    if (tension == null || tension < 0 || tension > 1) fail("segment tension invalid");
    if (echoMs == null || echoMs < 0) fail("segment echo invalid");
    if (tick == null) fail("segment tick invalid");
    if (!why) fail("segment why required");

    if (echoMs > 0) {
      const allowedLag = Math.abs(lag.bestLagDays) >= 2 && lag.confidence >= 0.6;
      if (!allowedLag) fail("echo not allowed for this lag profile");
      if (echoMs < 120 || echoMs > 220) fail("echo must be 120..220ms");
    }

    if (tick) tickCount += 1;

    normalizedSegments.push({
      startStep,
      endStep,
      chord,
      tension,
      echo_ms: echoMs,
      tick,
      why,
    });
    expectedStart = endStep + 1;
  }

  if (expectedStart !== stepCount) fail("segments must cover the full range");
  if (tickCount > 2) fail("tick count exceeds limit");

  const normalizedMarkers = markers.map((marker) => {
    if (!marker || typeof marker !== "object") fail("marker must be an object");
    const step = asNumber(marker.step);
    const label = asString(marker.label);
    const type = asString(marker.type);
    if (step == null || !Number.isInteger(step) || step < 0 || step >= stepCount) fail("marker step invalid");
    if (!label) fail("marker label required");
    if (!ALLOWED_MARKER_TYPES.has(type)) fail("marker type invalid");
    return { step, label, type };
  });

  const usedFeatures = Array.isArray(debug.usedFeatures) ? debug.usedFeatures.filter((entry) => typeof entry === "string") : null;
  const notes = asString(debug.notes);
  if (!usedFeatures) fail("debug.usedFeatures invalid");
  if (notes == null) fail("debug.notes invalid");

  return {
    caption,
    primary_insight: primaryInsight,
    audio_plan: {
      base_freq_hz: 220,
      waveform: "triangle",
      segments: normalizedSegments,
    },
    markers: normalizedMarkers,
    debug: {
      usedFeatures,
      notes,
    },
  };
}
