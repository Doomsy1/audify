const AUDIO_PLAN_PROMPT = `
You are generating an interpretable analytics audio plan for a constrained Shopify demo.
Return JSON only. No markdown. No prose outside the JSON object.

Input JSON:
{
  featureVersion: string,
  demoModeHint: "CALIBRATE"|"DIVERGENCE"|"LAG"|"SHIFT"|"FREEFORM",
  seriesLength: number,
  selection: {
    startDay: number,
    endDay: number,
    lengthDays: number,
    rollingWindow: number,
    msPerStep: number
  },
  correlation: {
    mean: number,
    min: number,
    max: number,
    std: number,
    slope: number,
    emaMean: number
  },
  divergence: {
    mean: number,
    max: number,
    p90: number,
    spikeCount: number,
    spikeDays: number[]
  },
  lag: {
    bestLagDays: number,
    confidence: number,
    corrAtBestLag: number
  },
  changePoints: {
    corrChangeDays: number[],
    regimeShiftDays: number[]
  },
  constraints: {
    maxSegments: number,
    minSegmentLength: number,
    maxTicks: number,
    echoMinMs: number,
    echoMaxMs: number
  }
}

Output JSON schema:
{
  "caption": "string",
  "primary_insight": "ALIGNMENT"|"DIVERGENCE"|"LAG"|"REGIME_SHIFT"|"NO_CLEAR_SIGNAL",
  "audio_plan": {
    "base_freq_hz": 220,
    "waveform": "triangle",
    "segments": [
      {
        "startStep": 0,
        "endStep": 0,
        "chord": "fifth"|"third"|"unison"|"tritone",
        "tension": 0,
        "echo_ms": 0,
        "tick": false,
        "why": "short string"
      }
    ]
  },
  "markers": [
    { "step": 0, "label": "string", "type": "change"|"spike"|"lag"|"shift" }
  ],
  "debug": {
    "usedFeatures": ["string"],
    "notes": "string"
  }
}

Hard constraints:
- segments must cover the full step range [0..N-1] with no gaps and no overlap
- segment count <= 3
- each segment length >= 3
- waveform must stay "triangle"
- base_freq_hz must stay 220
- chord controls interval only
- tension is a subtle gain shading hint only, choose 0..1
- echo_ms must be 0 unless abs(bestLagDays) >= 2 and confidence >= 0.6
- if echo_ms > 0 it must be between 120 and 220
- tick only for change or shift points, max 2 ticks total
- keep the plan demo-friendly and clearly interpretable
- CALIBRATE should favor stable consonance
- DIVERGENCE should emphasize tension and a spike marker
- LAG should make the lag audible with a restrained echo and a marker
- SHIFT should place a single clear tick around the shift and a chord change across it
`.trim();

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
  const cleaned = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

export async function generateBackboardAudioPlan(features) {
  const url = process.env.BACKBOARD_API_URL;
  const apiKey = process.env.BACKBOARD_API_KEY;
  const model = process.env.BACKBOARD_MODEL || "claude-sonnet-4-6";

  if (!url || !apiKey) {
    throw new Error("Backboard is not configured");
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
          content: [{ type: "input_text", text: AUDIO_PLAN_PROMPT }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(features) }],
        },
      ],
      text: {
        format: { type: "json_object" },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Backboard request failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  const text = extractTextPayload(payload);
  if (!text) {
    throw new Error("Backboard returned no text");
  }

  return parseJsonResponse(text);
}
