import test from "node:test";
import assert from "node:assert/strict";

import {
  getBackboardSettings,
  maybeRefineAgentResponse,
  resolveBackboardProvider,
} from "../backboardAgent.server.js";

function makeJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test("resolveBackboardProvider maps common model families", () => {
  assert.equal(resolveBackboardProvider("claude-sonnet-4-6"), "anthropic");
  assert.equal(resolveBackboardProvider("gpt-4.1-mini"), "openai");
  assert.equal(resolveBackboardProvider("o3-mini"), "openai");
  assert.equal(resolveBackboardProvider("gemini-2.5-flash"), "google");
  assert.equal(resolveBackboardProvider("custom-model"), null);
});

test("maybeRefineAgentResponse uses Backboard assistants+threads flow with X-API-Key", async () => {
  const previousEnv = {
    BACKBOARD_API_URL: process.env.BACKBOARD_API_URL,
    BACKBOARD_API_KEY: process.env.BACKBOARD_API_KEY,
    BACKBOARD_MODEL: process.env.BACKBOARD_MODEL,
  };
  const previousFetch = global.fetch;
  const calls = [];

  process.env.BACKBOARD_API_URL = "https://app.backboard.io/api";
  process.env.BACKBOARD_API_KEY = "bb_key_test";
  process.env.BACKBOARD_MODEL = "claude-sonnet-4-6";

  global.fetch = async (url, init = {}) => {
    calls.push({ url, init });

    if (url.endsWith("/assistants")) {
      return makeJsonResponse(200, { id: "assistant_1" });
    }
    if (url.endsWith("/assistants/assistant_1/threads")) {
      return makeJsonResponse(200, { thread_id: "thread_1" });
    }
    if (url.endsWith("/threads/thread_1/messages")) {
      return makeJsonResponse(200, {
        content: "{\"spoken\":\"Refined\",\"display\":{\"bullets\":[\"B1\"],\"suggested_questions\":[\"Q1\"]}}",
      });
    }

    return makeJsonResponse(404, { error: "unexpected request" });
  };

  try {
    const settings = getBackboardSettings();
    assert.equal(settings.configured, true);

    const result = await maybeRefineAgentResponse({
      utterance: "How are we doing?",
      intent: "summary",
      listen_mode: false,
      tool_results: {},
      fallback: { spoken: "fallback", display: { bullets: ["f"], suggested_questions: ["q"] } },
    });

    assert.equal(calls.length, 3);
    assert.deepEqual(result, {
      spoken: "Refined",
      display: {
        bullets: ["B1"],
        suggested_questions: ["Q1"],
      },
    });

    for (const call of calls) {
      assert.equal(call.init?.headers?.["X-API-Key"], "bb_key_test");
      assert.equal(call.init?.headers?.["Content-Type"], "application/json");
    }

    const messageCall = calls.find((call) => call.url.endsWith("/threads/thread_1/messages"));
    const messageBody = JSON.parse(messageCall.init.body);
    assert.equal(messageBody.model_name, "claude-sonnet-4-6");
    assert.equal(messageBody.llm_provider, "anthropic");
    assert.equal(typeof messageBody.content, "string");
  } finally {
    global.fetch = previousFetch;
    process.env.BACKBOARD_API_URL = previousEnv.BACKBOARD_API_URL;
    process.env.BACKBOARD_API_KEY = previousEnv.BACKBOARD_API_KEY;
    process.env.BACKBOARD_MODEL = previousEnv.BACKBOARD_MODEL;
  }
});
