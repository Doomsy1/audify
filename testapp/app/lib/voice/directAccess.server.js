import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_KIND = "voice_direct";
const TOKEN_TTL_MS = 1000 * 60 * 30;

function getSecret() {
  return process.env.VOICE_DIRECT_SECRET || process.env.SHOPIFY_API_SECRET || "dev-voice-direct-secret";
}

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signSegment(segment) {
  return createHmac("sha256", getSecret())
    .update(segment)
    .digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createVoiceDirectToken({ shop, ttlMs = TOKEN_TTL_MS }) {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required for voice direct access");
  }

  const payload = {
    kind: TOKEN_KIND,
    shop,
    exp: Date.now() + ttlMs,
  };

  const payloadSegment = encodeBase64Url(JSON.stringify(payload));
  const signatureSegment = signSegment(payloadSegment);

  return `${payloadSegment}.${signatureSegment}`;
}

export function verifyVoiceDirectToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const [payloadSegment, signatureSegment, extraSegment] = token.split(".");
  if (!payloadSegment || !signatureSegment || extraSegment) {
    return null;
  }

  const expectedSignature = signSegment(payloadSegment);
  if (!safeEqual(signatureSegment, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(payloadSegment));

    if (payload?.kind !== TOKEN_KIND) {
      return null;
    }

    if (!payload?.shop || typeof payload.shop !== "string") {
      return null;
    }

    if (!payload?.exp || payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function extractVoiceDirectToken(request) {
  const url = new URL(request.url);
  const headerToken = request.headers.get("x-voice-direct-token");
  if (headerToken) {
    return headerToken;
  }

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return url.searchParams.get("voice_token") || "";
}

export function buildVoiceDirectUrl({ requestUrl, shop }) {
  const requestOrigin = new URL(requestUrl).origin;
  const origin = process.env.SHOPIFY_APP_URL || requestOrigin;
  const standaloneUrl = new URL("/voice-direct", origin);
  standaloneUrl.searchParams.set("voice_token", createVoiceDirectToken({ shop }));
  return standaloneUrl.toString();
}
