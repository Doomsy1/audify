/* eslint-env node */
import test from "node:test";
import assert from "node:assert/strict";

process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "test_key";
process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "test_secret";
process.env.SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || "https://example.com";
process.env.SCOPES = process.env.SCOPES || "read_orders";

async function importRoute(path) {
  return import(new URL(path, import.meta.url));
}

function requestWithJson({ url = "https://example.com/api", method = "GET", body, throwOnJson = false }) {
  return {
    method,
    url,
    async json() {
      if (throwOnJson) {
        throw new Error("Invalid JSON");
      }
      return body;
    },
  };
}

test("api.agent.respond action handles invalid json and success", async () => {
  const route = await importRoute("../api.agent.respond.js");
  const calls = [];
  const action = route.createAgentRespondAction({
    authenticateAdmin: async () => ({ session: { shop: "demo.myshopify.com", accessToken: "tok" } }),
    respond: async (input) => {
      calls.push(input);
      return { spoken: "ok" };
    },
  });

  const bad = await action({
    request: requestWithJson({ throwOnJson: true, method: "POST" }),
  });
  assert.equal(bad.status, 400);

  const good = await action({
    request: requestWithJson({ body: { utterance: "hello" }, method: "POST" }),
  });
  assert.equal(good.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].shop, "demo.myshopify.com");
  assert.equal(calls[0].accessToken, "tok");
});

test("api.audio-plan action validates body and returns generated plan", async () => {
  const route = await importRoute("../api.audio-plan.js");
  const action = route.createAudioPlanAction({
    authenticateAdmin: async () => null,
    computeFeatures: () => ({
      featureVersion: "v1",
      demoModeHint: "FREEFORM",
      seriesLength: 7,
      selection: { startDay: 0, endDay: 6, lengthDays: 7, rollingWindow: 3, msPerStep: 200 },
      correlation: { mean: 0, min: -1, max: 1, std: 0.1, slope: 0, emaMean: 0 },
      divergence: { mean: 0.1, max: 0.9, p90: 0.7, spikeCount: 1, spikeDays: [2] },
      lag: { bestLagDays: 0, confidence: 0.2, corrAtBestLag: 0.1 },
      changePoints: { corrChangeDays: [], regimeShiftDays: [] },
      constraints: { maxSegments: 3, minSegmentLength: 3, maxTicks: 2, echoMinMs: 120, echoMaxMs: 220 },
    }),
    generatePlan: async () => ({ caption: "ok", primary_insight: "ALIGNMENT", audio_plan: { base_freq_hz: 220, waveform: "triangle", segments: [] }, markers: [], debug: { usedFeatures: [], notes: "" } }),
    validatePlan: (plan) => plan,
  });

  const invalid = await action({
    request: requestWithJson({ body: { xSeries: [1], ySeries: [1], selectionStart: 0, selectionEnd: 0, rollingWindow: 3, msPerStep: 200 }, method: "POST" }),
  });
  assert.equal(invalid.status, 400);

  const valid = await action({
    request: requestWithJson({
      body: {
        xSeries: [1, 2, 3, 4, 5, 6, 7],
        ySeries: [1, 2, 3, 4, 5, 6, 7],
        selectionStart: 0,
        selectionEnd: 6,
        rollingWindow: 3,
        msPerStep: 200,
      },
      method: "POST",
    }),
  });
  assert.equal(valid.status, 200);
  const json = await valid.json();
  assert.equal(json.ok, true);
});

test("audio clip loaders return 404 and clip response", async () => {
  const ttsRoute = await importRoute("../api.tts.audio.$clipId.js");
  const sonRoute = await importRoute("../api.sonify.audio.$clipId.js");
  const clip = { body: new Uint8Array([1, 2]), contentType: "audio/wav" };

  const ttsLoader = ttsRoute.createClipLoader({
    loadClip: (id) => (id === "ok" ? clip : null),
  });
  const sonLoader = sonRoute.createClipLoader({
    loadClip: () => clip,
  });

  const missing = await ttsLoader({ params: { clipId: "missing" } });
  assert.equal(missing.status, 404);

  const ttsHit = await ttsLoader({ params: { clipId: "ok" } });
  assert.equal(ttsHit.status, 200);
  assert.equal(ttsHit.headers.get("Content-Type"), "audio/wav");

  const sonHit = await sonLoader({ params: { clipId: "any" } });
  assert.equal(sonHit.status, 200);
});

test("metrics endpoint loaders parse params and handle errors", async () => {
  const summary = await importRoute("../api.metrics.summary.js");
  const compare = await importRoute("../api.metrics.compare.js");
  const timeseries = await importRoute("../api.metrics.timeseries.js");
  const breakdown = await importRoute("../api.metrics.breakdown.js");
  const anomalies = await importRoute("../api.metrics.anomalies.js");

  const summaryLoader = summary.createMetricsSummaryLoader({
    authenticateAdmin: async () => null,
    query: (args) => ({ type: "summary", args }),
  });
  const summaryRes = await summaryLoader({
    request: requestWithJson({ url: "https://example.com/api?range=today&tz=UTC" }),
  });
  assert.equal(summaryRes.status, 200);

  const compareLoader = compare.createMetricsCompareLoader({
    authenticateAdmin: async () => null,
    query: () => {
      throw new Error("bad");
    },
  });
  const compareRes = await compareLoader({
    request: requestWithJson({ url: "https://example.com/api" }),
  });
  assert.equal(compareRes.status, 400);

  const timeseriesLoader = timeseries.createMetricsTimeseriesLoader({
    authenticateAdmin: async () => null,
    query: (args) => ({ args }),
  });
  const tsRes = await timeseriesLoader({
    request: requestWithJson({ url: "https://example.com/api?metric=orders&bucket=day" }),
  });
  assert.equal(tsRes.status, 200);

  const breakdownLoader = breakdown.createMetricsBreakdownLoader({
    authenticateAdmin: async () => null,
    query: () => ({ rows: [] }),
  });
  const bdRes = await breakdownLoader({
    request: requestWithJson({ url: "https://example.com/api?by=product" }),
  });
  assert.equal(bdRes.status, 200);

  const anomaliesLoader = anomalies.createMetricsAnomaliesLoader({
    authenticateAdmin: async () => null,
    detect: (args) => ({ anomalies: [], args }),
  });
  const anRes = await anomaliesLoader({
    request: requestWithJson({ url: "https://example.com/api?window=10&z=2.5" }),
  });
  assert.equal(anRes.status, 200);
});

test("sonify endpoint actions validate method/body and render", async () => {
  const seriesRoute = await importRoute("../api.sonify.series.js");
  const compareRoute = await importRoute("../api.sonify.compare.js");

  const seriesAction = seriesRoute.createSonifySeriesAction({
    authenticateAdmin: async () => null,
    renderSeries: () => ({ audio_url: "/api/sonify/audio/1" }),
  });

  const methodFail = await seriesAction({
    request: requestWithJson({ method: "GET" }),
  });
  assert.equal(methodFail.status, 405);

  const badBody = await seriesAction({
    request: requestWithJson({ method: "POST", body: { series: { points: [] } } }),
  });
  assert.equal(badBody.status, 400);

  const okSeries = await seriesAction({
    request: requestWithJson({
      method: "POST",
      body: { series: { points: [{ t: "a", v: 1 }] } },
    }),
  });
  assert.equal(okSeries.status, 200);

  const compareAction = compareRoute.createSonifyCompareAction({
    authenticateAdmin: async () => null,
    renderCompare: () => ({ audio_url: "/api/sonify/audio/2" }),
  });

  const badCompare = await compareAction({
    request: requestWithJson({
      method: "POST",
      body: { a: { points: [{ t: "a", v: 1 }] }, b: { points: [{ t: "b", v: 2 }] } },
    }),
  });
  assert.equal(badCompare.status, 400);

  const okCompare = await compareAction({
    request: requestWithJson({
      method: "POST",
      body: {
        a: { label: "A", points: [{ t: "a", v: 1 }] },
        b: { label: "B", points: [{ t: "b", v: 2 }] },
      },
    }),
  });
  assert.equal(okCompare.status, 200);
});

test("webhook endpoints update persistence only when session exists", async () => {
  const uninstalled = await importRoute("../webhooks.app.uninstalled.js");
  const scopes = await importRoute("../webhooks.app.scopes_update.js");

  let deleted = 0;
  const uninstalledAction = uninstalled.createWebhookUninstalledAction({
    authenticateWebhook: async () => ({
      shop: "demo.myshopify.com",
      session: { id: "s1" },
      topic: "app/uninstalled",
    }),
    deleteSessionsByShop: async () => {
      deleted += 1;
    },
  });
  const uninstallRes = await uninstalledAction({ request: {} });
  assert.equal(uninstallRes.status, 200);
  assert.equal(deleted, 1);

  let updated = 0;
  const scopesAction = scopes.createWebhookScopesUpdateAction({
    authenticateWebhook: async () => ({
      payload: { current: "read_orders" },
      session: { id: "s2" },
      topic: "app/scopes_update",
      shop: "demo.myshopify.com",
    }),
    updateSessionScope: async ({ data }) => {
      updated += 1;
      assert.equal(data.scope, "read_orders");
    },
  });
  const scopesRes = await scopesAction({ request: {} });
  assert.equal(scopesRes.status, 200);
  assert.equal(updated, 1);
});

test("auth catchall endpoint authenticates and returns null", async () => {
  const authCatchall = await importRoute("../auth.$.js");
  let called = 0;
  const loader = authCatchall.createAuthCatchallLoader({
    authenticateAdmin: async () => {
      called += 1;
    },
  });

  const result = await loader({
    request: requestWithJson({ url: "https://example.com/auth/test" }),
  });
  assert.equal(result, null);
  assert.equal(called, 1);
});
