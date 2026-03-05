/**
 * Canonical enum definitions for the catalog system.
 *
 * This file is the SINGLE SOURCE OF TRUTH for all enum-like values
 * shared between catalog schemas (Zod) and runtime types (shared/).
 *
 * - catalog/schemas/ uses these via z.nativeEnum()
 * - shared/data/types/ re-exports these directly
 *
 * Pure TypeScript — no Zod dependency.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Endpoint Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Endpoint type determines which SDK handler / request format to use */
export enum EndpointType {
  // Text generation (different formats)
  CHAT_COMPLETIONS = 'chat_completions', // OpenAI /v1/chat/completions
  TEXT_COMPLETIONS = 'text_completions', // OpenAI /v1/completions
  MESSAGES = 'messages', // Anthropic /v1/messages
  RESPONSES = 'responses', // OpenAI /responses
  GENERATE_CONTENT = 'generate_content', // Gemini generateContent

  // Ollama native API
  OLLAMA_CHAT = 'ollama_chat', // Ollama /api/chat
  OLLAMA_GENERATE = 'ollama_generate', // Ollama /api/generate

  // Embeddings
  EMBEDDINGS = 'embeddings',
  RERANK = 'rerank',

  // Images
  IMAGE_GENERATION = 'image_generation',
  IMAGE_EDIT = 'image_edit',

  // Audio
  AUDIO_TRANSCRIPTION = 'audio_transcription',
  AUDIO_TRANSLATION = 'audio_translation',
  TEXT_TO_SPEECH = 'text_to_speech',

  // Video
  VIDEO_GENERATION = 'video_generation'
}

// ═══════════════════════════════════════════════════════════════════════════════
// Model Capability Types
// ═══════════════════════════════════════════════════════════════════════════════

export enum ModelCapability {
  FUNCTION_CALL = 'function_call',
  REASONING = 'reasoning',
  IMAGE_RECOGNITION = 'image_recognition',
  IMAGE_GENERATION = 'image_generation',
  AUDIO_RECOGNITION = 'audio_recognition',
  AUDIO_GENERATION = 'audio_generation',
  EMBEDDING = 'embedding',
  RERANK = 'rerank',
  AUDIO_TRANSCRIPT = 'audio_transcript',
  VIDEO_RECOGNITION = 'video_recognition',
  VIDEO_GENERATION = 'video_generation',
  STRUCTURED_OUTPUT = 'structured_output',
  FILE_INPUT = 'file_input',
  WEB_SEARCH = 'web_search',
  CODE_EXECUTION = 'code_execution',
  FILE_SEARCH = 'file_search',
  COMPUTER_USE = 'computer_use'
}

// ═══════════════════════════════════════════════════════════════════════════════
// Modality Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Supported input/output modality types */
export enum Modality {
  TEXT = 'TEXT',
  VISION = 'VISION',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  VECTOR = 'VECTOR'
}
