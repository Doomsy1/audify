/**
 * @typedef {Object} ClientVoiceRequest
 * @property {string} utterance
 * @property {{
 *   tz: string,
 *   listen_mode: boolean,
 *   client_request_id: string,
 *   session_id: string,
 * }} context
 * @property {{ sonify_speed: number }} overrides
 */

/**
 * @typedef {Object} ClientVoiceAudioItem
 * @property {"tts" | "sonification"} type
 * @property {string} label
 * @property {string} audio_url
 */

/**
 * @typedef {Object} ClientVoiceResponse
 * @property {string} spoken
 * @property {{
 *   bullets?: string[],
 *   suggested_questions?: string[],
 * }} [display]
 * @property {ClientVoiceAudioItem[]} [audio]
 * @property {{ series?: { points?: Array<{t: string, v: number}> } | null }} [chart]
 * @property {Array<{tool: string, args: Record<string, unknown>, status: string}>} [tool_trace]
 * @property {{ backboard?: { attempted: boolean, refined: boolean } }} [meta]
 */

export const VOICE_RESPONSE_ENDPOINT = "/api/agent/respond";

