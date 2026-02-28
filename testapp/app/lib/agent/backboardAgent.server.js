import { AGENT_RESPONSE_PROMPT } from "./prompt.js";

export function getBackboardSettings() {
  const url = process.env.BACKBOARD_API_URL;
  const apiKey = process.env.BACKBOARD_API_KEY;
  const model = process.env.BACKBOARD_MODEL || "gpt-4.1-mini";

  return {
    url,
    apiKey,
    model,
    configured: Boolean(url && apiKey),
  };
}

function normalizeBaseUrl(url) {
  if (!url) {
    return "";
  }
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function resolveBackboardProvider(modelName) {
  if (!modelName || typeof modelName !== "string") {
    return null;
  }
  const model = modelName.toLowerCase();
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) {
    return "openai";
  }
  if (model.startsWith("gemini")) return "google";
  return null;
}

function extractTextPayload(payload) {
  if (typeof payload === "string") return payload;
  if (!payload) return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  if (Array.isArray(payload.output_text)) return payload.output_text.join("");
  if (Array.isArray(payload.output)) {
    const chunks = [];
    for (const item of payload.output) {
      if (!item || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (typeof part?.text === "string") chunks.push(part.text);
      }
    }
    if (chunks.length) return chunks.join("");
  }
  if (Array.isArray(payload.choices) && payload.choices[0]?.message?.content) {
    const content = payload.choices[0].message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((entry) => entry?.text ?? entry?.content ?? "").join("");
    }
  }
  return "";
}

function parseJsonResponse(text) {
  const trimmed = text.trim();
  const cleaned = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  return JSON.parse(cleaned);
}

async function parseErrorBody(response) {
  try {
    const text = await response.text();
    if (!text) return "";
    return text.slice(0, 200);
  } catch {
    return "";
  }
}

async function requestBackboardJson({ url, apiKey, payload }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await parseErrorBody(response);
    const suffix = body ? `: ${body}` : "";
    throw new Error(`Backboard request failed (${response.status})${suffix}`);
  }

  return response.json();
}

function buildBackboardPrompt(input) {
  return `${AGENT_RESPONSE_PROMPT}\n\nInput JSON:\n${JSON.stringify(input)}`;
}

export async function maybeRefineAgentResponse(input) {
  const { url, apiKey, model, configured } = getBackboardSettings();

  if (!configured) {
    return null;
  }

  const baseUrl = normalizeBaseUrl(url);
  const assistant = await requestBackboardJson({
    url: `${baseUrl}/assistants`,
    apiKey,
    payload: {
      name: "Audify Response Refiner",
      system_prompt: "You improve assistant responses for analytics clarity.",
    },
  });
  const assistantId = assistant?.assistant_id ?? assistant?.id;
  if (!assistantId) {
    throw new Error("Backboard assistant response missing assistant identifier");
  }

  const thread = await requestBackboardJson({
    url: `${baseUrl}/assistants/${assistantId}/threads`,
    apiKey,
    payload: {},
  });

  const provider = resolveBackboardProvider(model);
  const message = await requestBackboardJson({
    url: `${baseUrl}/threads/${thread.thread_id}/messages`,
    apiKey,
    payload: {
      content: buildBackboardPrompt(input),
      model_name: model,
      ...(provider ? { llm_provider: provider } : {}),
      stream: false,
      memory: "off",
      web_search: "off",
      send_to_llm: "true",
    },
  });

  const text = extractTextPayload(message?.content ?? message);
  if (!text) return null;

  return parseJsonResponse(text);
}
