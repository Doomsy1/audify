import { AGENT_RESPONSE_PROMPT } from "./prompt";

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

function extractTextPayload(payload) {
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

export async function maybeRefineAgentResponse(input) {
  const { url, apiKey, model, configured } = getBackboardSettings();

  if (!configured) {
    return null;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: AGENT_RESPONSE_PROMPT }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(input) }],
        },
      ],
      text: {
        format: { type: "json_object" },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Backboard request failed (${response.status})`);
  }

  const payload = await response.json();
  const text = extractTextPayload(payload);
  if (!text) return null;

  return parseJsonResponse(text);
}
