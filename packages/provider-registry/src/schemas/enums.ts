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

export const ENDPOINT_TYPE = {
  ANTHROPIC_MESSAGES: 'anthropic-messages',
  GOOGLE_GENERATE_CONTENT: 'google-generate-content',
  JINA_RERANK: 'jina-rerank',
  OLLAMA_CHAT: 'ollama-chat',
  OLLAMA_GENERATE: 'ollama-generate',
  OPENAI_AUDIO_TRANSCRIPTION: 'openai-audio-transcription',
  OPENAI_AUDIO_TRANSLATION: 'openai-audio-translation',
  OPENAI_CHAT_COMPLETIONS: 'openai-chat-completions',
  OPENAI_EMBEDDINGS: 'openai-embeddings',
  OPENAI_IMAGE_EDIT: 'openai-image-edit',
  OPENAI_IMAGE_GENERATION: 'openai-image-generation',
  OPENAI_RESPONSES: 'openai-responses',
  OPENAI_TEXT_COMPLETIONS: 'openai-text-completions',
  OPENAI_TEXT_TO_SPEECH: 'openai-text-to-speech',
  OPENAI_VIDEO_GENERATION: 'openai-video-generation'
} as const
export type EndpointType = (typeof ENDPOINT_TYPE)[keyof typeof ENDPOINT_TYPE]

// ─────────────────────────────────────────────────────────────────────────────
// ModelCapability
// ─────────────────────────────────────────────────────────────────────────────

export const MODEL_CAPABILITY = {
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
export type ModelCapability = (typeof MODEL_CAPABILITY)[keyof typeof MODEL_CAPABILITY]

// ─────────────────────────────────────────────────────────────────────────────
// Modality
// ─────────────────────────────────────────────────────────────────────────────

export const MODALITY = {
  TEXT: 'text',
  IMAGE: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
  VECTOR: 'vector'
} as const
export type Modality = (typeof MODALITY)[keyof typeof MODALITY]

// ─────────────────────────────────────────────────────────────────────────────
// Currency
// ─────────────────────────────────────────────────────────────────────────────

// Uses uppercase ISO 4217 codes (not kebab-case) — intentional exception
export const CURRENCY = {
  USD: 'USD',
  CNY: 'CNY'
} as const
export type Currency = (typeof CURRENCY)[keyof typeof CURRENCY]

// ─────────────────────────────────────────────────────────────────────────────
// ReasoningEffort
// ─────────────────────────────────────────────────────────────────────────────

export const REASONING_EFFORT = {
  NONE: 'none',
  MINIMAL: 'minimal',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  MAX: 'max',
  AUTO: 'auto'
} as const
export type ReasoningEffort = (typeof REASONING_EFFORT)[keyof typeof REASONING_EFFORT]

// ─────────────────────────────────────────────────────────────────────────────
// Provider-specific reasoning effort enums
// ─────────────────────────────────────────────────────────────────────────────

export const OPENAI_REASONING_EFFORT = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  XHIGH: 'xhigh'
} as const
export type OpenAIReasoningEffort = (typeof OPENAI_REASONING_EFFORT)[keyof typeof OPENAI_REASONING_EFFORT]

export const ANTHROPIC_REASONING_EFFORT = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  MAX: 'max'
} as const
export type AnthropicReasoningEffort = (typeof ANTHROPIC_REASONING_EFFORT)[keyof typeof ANTHROPIC_REASONING_EFFORT]

export const GEMINI_THINKING_LEVEL = {
  MINIMAL: 'minimal',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
} as const
export type GeminiThinkingLevel = (typeof GEMINI_THINKING_LEVEL)[keyof typeof GEMINI_THINKING_LEVEL]

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the value tuple from a const object for use with z.enum(). */
export function objectValues<T extends Record<string, string | number>>(obj: T): [T[keyof T], ...T[keyof T][]] {
  return Object.values(obj) as [T[keyof T], ...T[keyof T][]]
}
