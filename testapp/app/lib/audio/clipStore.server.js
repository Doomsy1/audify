const MAX_CLIPS = 100;
const DEFAULT_TTL_MS = 1000 * 60 * 15;

const clips = new Map();

function now() {
  return Date.now();
}

function evictExpired() {
  const current = now();
  for (const [key, clip] of clips.entries()) {
    if (clip.expiresAt <= current) {
      clips.delete(key);
    }
  }
}

function evictOverflow() {
  while (clips.size > MAX_CLIPS) {
    const oldestKey = clips.keys().next().value;
    clips.delete(oldestKey);
  }
}

function touch(id, clip) {
  clips.delete(id);
  clips.set(id, clip);
}

export function putClip({
  prefix = "clip",
  body,
  contentType = "application/octet-stream",
  ttlMs = DEFAULT_TTL_MS,
}) {
  evictExpired();

  const id = `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  const value = {
    id,
    body: body instanceof Uint8Array ? body : new Uint8Array(body),
    contentType,
    createdAt: now(),
    expiresAt: now() + ttlMs,
  };

  clips.set(id, value);
  evictOverflow();

  return {
    clipId: id,
    contentType: value.contentType,
  };
}

export function getClip(id) {
  evictExpired();

  const clip = clips.get(id);
  if (!clip) return null;

  touch(id, clip);
  return clip;
}
