import { authenticate } from "../shopify.server.js";
import { generateBackboardAudioPlan } from "../lib/audioPlan/backboard.server.js";
import { computeAudioPlanFeatures, FEATURE_VERSION } from "../lib/audioPlan/features.js";
import { validateAudioPlanResponse } from "../lib/audioPlan/schema.js";

const MAX_CACHE_ENTRIES = 50;
const cache = new Map();

function lruGet(key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function lruSet(key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = cache.keys().next().value;
  cache.delete(oldest);
}

function badRequest(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export function createAudioPlanAction({
  authenticateAdmin,
  generatePlan,
  computeFeatures,
  validatePlan,
}) {
  return async ({ request }) => {
    await authenticateAdmin(request);

    let payload;
    try {
      payload = await request.json();
    } catch (_) {
      return badRequest("Invalid JSON body");
    }

    const xSeries = Array.isArray(payload?.xSeries) ? payload.xSeries : null;
    const ySeries = Array.isArray(payload?.ySeries) ? payload.ySeries : null;
    const selectionStart = Number(payload?.selectionStart);
    const selectionEnd = Number(payload?.selectionEnd);
    const rollingWindow = Number(payload?.rollingWindow);
    const msPerStep = Number(payload?.msPerStep);
    const demoModeHint = typeof payload?.demoModeHint === "string" ? payload.demoModeHint : "FREEFORM";
    const datasetId = typeof payload?.datasetId === "string" ? payload.datasetId : "unknown";

    if (!xSeries || !ySeries || xSeries.length !== ySeries.length || xSeries.length < 7) {
      return badRequest("Series arrays are required");
    }
    if (!Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd)) {
      return badRequest("Selection indices are required");
    }
    if (!Number.isFinite(rollingWindow) || !Number.isFinite(msPerStep)) {
      return badRequest("rollingWindow and msPerStep are required");
    }

    const cacheKey = [
      datasetId,
      selectionStart,
      selectionEnd,
      rollingWindow,
      demoModeHint,
      FEATURE_VERSION,
    ].join(":");

    const cached = lruGet(cacheKey);
    if (cached) {
      return Response.json({ ok: true, cached: true, ...cached });
    }

    const features = computeFeatures({
      xSeries,
      ySeries,
      selectionStart,
      selectionEnd,
      rollingWindow,
      msPerStep,
      demoModeHint,
    });

    const promptInput = {
      featureVersion: features.featureVersion,
      demoModeHint: features.demoModeHint,
      seriesLength: features.seriesLength,
      selection: features.selection,
      correlation: {
        mean: features.correlation.mean,
        min: features.correlation.min,
        max: features.correlation.max,
        std: features.correlation.std,
        slope: features.correlation.slope,
        emaMean: features.correlation.emaMean,
      },
      divergence: {
        mean: features.divergence.mean,
        max: features.divergence.max,
        p90: features.divergence.p90,
        spikeCount: features.divergence.spikeCount,
        spikeDays: features.divergence.spikeDays,
      },
      lag: features.lag,
      changePoints: features.changePoints,
      constraints: features.constraints,
    };

    try {
      const rawPlan = await generatePlan(promptInput);
      const plan = validatePlan(rawPlan, {
        stepCount: features.seriesLength,
        lag: features.lag,
      });
      const result = {
        plan,
        features: promptInput,
        featureVersion: FEATURE_VERSION,
      };
      lruSet(cacheKey, result);
      return Response.json({ ok: true, cached: false, ...result });
    } catch (error) {
      return Response.json({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to generate AI audio plan",
        features: promptInput,
        featureVersion: FEATURE_VERSION,
      }, { status: 502 });
    }
  };
}

export const action = createAudioPlanAction({
  authenticateAdmin: authenticate.admin,
  generatePlan: generateBackboardAudioPlan,
  computeFeatures: computeAudioPlanFeatures,
  validatePlan: validateAudioPlanResponse,
});
