/**
 * Canonical const-object definitions for the catalog system.
 *
 * This file is the SINGLE SOURCE OF TRUTH for all enum-like values
 * shared between catalog schemas (Zod) and runtime types (shared/).
 *
 * - catalog/schemas/ uses these via objectValues() + z.enum()
 * - shared/data/types/ re-exports these directly
 *
 * Pure TypeScript — no Zod dependency.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the value tuple from a const object for use with z.enum(). */
export function objectValues<T extends Record<string, string>>(obj: T): [T[keyof T], ...T[keyof T][]] {
  return Object.values(obj) as [T[keyof T], ...T[keyof T][]]
}

// ═══════════════════════════════════════════════════════════════════════════════
// Endpoint Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Endpoint type determines which SDK handler / request format to use */
export const ENDPOINT_TYPE = {
  // Text generation (different formats)
  CHAT_COMPLETIONS: 'chat_completions', // OpenAI /v1/chat/completions
  TEXT_COMPLETIONS: 'text_completions', // OpenAI /v1/completions
  MESSAGES: 'messages', // Anthropic /v1/messages
  RESPONSES: 'responses', // OpenAI /responses
  GENERATE_CONTENT: 'generate_content', // Gemini generateContent

  // Ollama native API
  OLLAMA_CHAT: 'ollama_chat', // Ollama /api/chat
  OLLAMA_GENERATE: 'ollama_generate', // Ollama /api/generate

  // Embeddings
  EMBEDDINGS: 'embeddings',
  RERANK: 'rerank',

  // Images
  IMAGE_GENERATION: 'image_generation',
  IMAGE_EDIT: 'image_edit',

  // Audio
  AUDIO_TRANSCRIPTION: 'audio_transcription',
  AUDIO_TRANSLATION: 'audio_translation',
  TEXT_TO_SPEECH: 'text_to_speech',

  // Video
  VIDEO_GENERATION: 'video_generation'
} as const

export type EndpointType = (typeof ENDPOINT_TYPE)[keyof typeof ENDPOINT_TYPE]

// ═══════════════════════════════════════════════════════════════════════════════
// Model Capability Types
// ═══════════════════════════════════════════════════════════════════════════════

export const MODEL_CAPABILITY = {
  FUNCTION_CALL: 'function_call',
  REASONING: 'reasoning',
  IMAGE_RECOGNITION: 'image_recognition',
  IMAGE_GENERATION: 'image_generation',
  AUDIO_RECOGNITION: 'audio_recognition',
  AUDIO_GENERATION: 'audio_generation',
  EMBEDDING: 'embedding',
  RERANK: 'rerank',
  AUDIO_TRANSCRIPT: 'audio_transcript',
  VIDEO_RECOGNITION: 'video_recognition',
  VIDEO_GENERATION: 'video_generation',
  STRUCTURED_OUTPUT: 'structured_output',
  FILE_INPUT: 'file_input',
  WEB_SEARCH: 'web_search',
  CODE_EXECUTION: 'code_execution',
  FILE_SEARCH: 'file_search',
  COMPUTER_USE: 'computer_use'
} as const

export type ModelCapability = (typeof MODEL_CAPABILITY)[keyof typeof MODEL_CAPABILITY]

// ═══════════════════════════════════════════════════════════════════════════════
// Modality Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Supported input/output modality types */
export const MODALITY = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  AUDIO: 'AUDIO',
  VIDEO: 'VIDEO',
  VECTOR: 'VECTOR'
} as const

export type Modality = (typeof MODALITY)[keyof typeof MODALITY]
