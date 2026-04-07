/**
 * Canonical enum definitions for the registry system.
 *
 * These are the SINGLE SOURCE OF TRUTH for all enum types.
 * Uses `as const` objects with kebab-case string values for debuggability.
 *
 * - registry/schemas/ uses these via z.enum()
 * - shared/data/types/ re-exports these directly
 */

// ─────────────────────────────────────────────────────────────────────────────
// EndpointType
// ─────────────────────────────────────────────────────────────────────────────

export const EndpointType = {
  OPENAI_CHAT_COMPLETIONS: 'openai-chat-completions',
  OPENAI_TEXT_COMPLETIONS: 'openai-text-completions',
  ANTHROPIC_MESSAGES: 'anthropic-messages',
  OPENAI_RESPONSES: 'openai-responses',
  GOOGLE_GENERATE_CONTENT: 'google-generate-content',
  OLLAMA_CHAT: 'ollama-chat',
  OLLAMA_GENERATE: 'ollama-generate',
  OPENAI_EMBEDDINGS: 'openai-embeddings',
  JINA_RERANK: 'jina-rerank',
  OPENAI_IMAGE_GENERATION: 'openai-image-generation',
  OPENAI_IMAGE_EDIT: 'openai-image-edit',
  OPENAI_AUDIO_TRANSCRIPTION: 'openai-audio-transcription',
  OPENAI_AUDIO_TRANSLATION: 'openai-audio-translation',
  OPENAI_TEXT_TO_SPEECH: 'openai-text-to-speech',
  OPENAI_VIDEO_GENERATION: 'openai-video-generation'
} as const
export type EndpointType = (typeof EndpointType)[keyof typeof EndpointType]

// ─────────────────────────────────────────────────────────────────────────────
// ModelCapability
// ─────────────────────────────────────────────────────────────────────────────

export const ModelCapability = {
  FUNCTION_CALL: 'function-call',
  REASONING: 'reasoning',
  IMAGE_RECOGNITION: 'image-recognition',
  IMAGE_GENERATION: 'image-generation',
  AUDIO_RECOGNITION: 'audio-recognition',
  AUDIO_GENERATION: 'audio-generation',
  EMBEDDING: 'embedding',
  RERANK: 'rerank',
  AUDIO_TRANSCRIPT: 'audio-transcript',
  VIDEO_RECOGNITION: 'video-recognition',
  VIDEO_GENERATION: 'video-generation',
  STRUCTURED_OUTPUT: 'structured-output',
  FILE_INPUT: 'file-input',
  WEB_SEARCH: 'web-search',
  CODE_EXECUTION: 'code-execution',
  FILE_SEARCH: 'file-search',
  COMPUTER_USE: 'computer-use'
} as const
export type ModelCapability = (typeof ModelCapability)[keyof typeof ModelCapability]

// ─────────────────────────────────────────────────────────────────────────────
// Modality
// ─────────────────────────────────────────────────────────────────────────────

export const Modality = {
  TEXT: 'text',
  IMAGE: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
  VECTOR: 'vector'
} as const
export type Modality = (typeof Modality)[keyof typeof Modality]

// ─────────────────────────────────────────────────────────────────────────────
// Currency
// ─────────────────────────────────────────────────────────────────────────────

// Uses uppercase ISO 4217 codes (not kebab-case) — intentional exception
export const Currency = {
  USD: 'USD',
  CNY: 'CNY'
} as const
export type Currency = (typeof Currency)[keyof typeof Currency]

// ─────────────────────────────────────────────────────────────────────────────
// ReasoningEffort
// ─────────────────────────────────────────────────────────────────────────────

export const ReasoningEffort = {
  NONE: 'none',
  MINIMAL: 'minimal',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  MAX: 'max',
  AUTO: 'auto'
} as const
export type ReasoningEffort = (typeof ReasoningEffort)[keyof typeof ReasoningEffort]

// ─────────────────────────────────────────────────────────────────────────────
// Provider-specific reasoning effort enums
// ─────────────────────────────────────────────────────────────────────────────

export const OpenAIReasoningEffort = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
} as const
export type OpenAIReasoningEffort = (typeof OpenAIReasoningEffort)[keyof typeof OpenAIReasoningEffort]

export const AnthropicReasoningEffort = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  MAX: 'max'
} as const
export type AnthropicReasoningEffort = (typeof AnthropicReasoningEffort)[keyof typeof AnthropicReasoningEffort]

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compatible aliases
// ─────────────────────────────────────────────────────────────────────────────

export const ENDPOINT_TYPE = EndpointType
export const MODEL_CAPABILITY = ModelCapability
export const MODALITY = Modality

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the value tuple from a const object for use with z.enum(). */
export function objectValues<T extends Record<string, string | number>>(obj: T): [T[keyof T], ...T[keyof T][]] {
  return Object.values(obj) as [T[keyof T], ...T[keyof T][]]
}
