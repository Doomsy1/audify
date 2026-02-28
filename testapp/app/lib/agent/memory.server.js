import { DEFAULT_AGENT_MEMORY } from "../contracts/agent";

const memoryStore = new Map();

export function getAgentMemory(key) {
  return {
    ...DEFAULT_AGENT_MEMORY,
    ...(memoryStore.get(key) ?? {}),
  };
}

export function updateAgentMemory(key, updates) {
  const next = {
    ...getAgentMemory(key),
    ...pickDefined(updates),
  };

  memoryStore.set(key, next);
  return next;
}

function pickDefined(value) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined),
  );
}
