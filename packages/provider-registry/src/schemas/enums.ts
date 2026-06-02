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
// CanonicalParamKey
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The closed vocabulary of image-generation param keys. A model declares a
 * subset of these under `imageGeneration.modes[mode].supports` (see
 * `ImageModeDefSchema`), and they flow end-to-end as `painting.params` keys.
 *
 * Unlike the other enums, the VALUES are camelCase on purpose: they ARE the
 * runtime param-bag keys and must match `painting.params`/registry data
 * verbatim — do NOT kebab-case them (it would break the wire contract).
 *
 * This is the single source of truth that ties together the registry schema,
 * the form's `KEY_LABELS`/`OPTION_LABELS`, and `canonicalGenerate`'s
 * `POSITIONAL_RENAME`. Adding a new canonical param is a deliberate change:
 * add the member here, give it a label in `KEY_LABELS`, and declare it on the
 * relevant models in registry data.
 */
export const CANONICAL_PARAM_KEY = {
  ADD_WATERMARK: 'addWatermark',
  ASPECT_RATIO: 'aspectRatio',
  BACKGROUND: 'background',
  BOTTOM_SCALE: 'bottomScale',
  CFG: 'cfg',
  CUSTOM_SIZE: 'customSize',
  DETAIL: 'detail',
  ENABLE_INTERLEAVE: 'enableInterleave',
  FUNCTION: 'function',
  GUIDANCE_SCALE: 'guidanceScale',
  IMAGE_RESOLUTION: 'imageResolution',
  IMAGE_WEIGHT: 'imageWeight',
  IS_SKETCH: 'isSketch',
  LEFT_SCALE: 'leftScale',
  MAGIC_PROMPT_OPTION: 'magicPromptOption',
  MAX_IMAGES: 'maxImages',
  MODERATION: 'moderation',
  NEGATIVE_PROMPT: 'negativePrompt',
  NUM_IMAGES: 'numImages',
  NUM_INFERENCE_STEPS: 'numInferenceSteps',
  OUTPUT_FORMAT: 'outputFormat',
  PERSON_GENERATION: 'personGeneration',
  PROMPT_ENHANCEMENT: 'promptEnhancement',
  PROMPT_EXTEND: 'promptExtend',
  QUALITY: 'quality',
  REF_MODE: 'refMode',
  REF_STRENGTH: 'refStrength',
  RENDERING_SPEED: 'renderingSpeed',
  RESEMBLANCE: 'resemblance',
  RIGHT_SCALE: 'rightScale',
  SAFETY_TOLERANCE: 'safetyTolerance',
  SEED: 'seed',
  SEQUENTIAL_IMAGE_GENERATION: 'sequentialImageGeneration',
  SIZE: 'size',
  SOURCE_LANG: 'sourceLang',
  STRENGTH: 'strength',
  STYLE: 'style',
  STYLE_TYPE: 'styleType',
  TARGET_LANG: 'targetLang',
  THINKING_MODE: 'thinkingMode',
  TOP_SCALE: 'topScale',
  UPSCALE_FACTOR: 'upscaleFactor'
} as const
export type CanonicalParamKey = (typeof CANONICAL_PARAM_KEY)[keyof typeof CANONICAL_PARAM_KEY]

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
