/**
 * Model identification and capability check functions.
 *
 * TODO: These are mock implementations. The real logic lives in
 * `src/renderer/src/config/models/` and `src/renderer/src/utils/provider.ts`.
 * They should be migrated here from renderer to become the single source of truth.
 * Until then, main process code uses these mocks with the same interface.
 *
 * Migration plan:
 * 1. Copy the actual implementations from renderer config/models/*.ts
 * 2. Update renderer to import from @shared/config/models
 * 3. Delete renderer's config/models/ originals
 */

// ============================================================================
// Types (can be used now)
// ============================================================================

/** Model type used by check functions — matches renderer's Model type */
export interface ModelLike {
  id: string
  name?: string
  provider?: string
  group?: string
}

// ============================================================================
// Model check functions — TODO: replace mocks with real implementations
// ============================================================================

/** Check if model is an OpenAI LLM model */
export function isOpenAILLMModel(model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/openai.ts
  return model.id.startsWith('gpt-') || model.id.startsWith('o1-') || model.id.startsWith('o3-')
}

/** Check if model only supports chat completion (no responses API) */
export function isOpenAIChatCompletionOnlyModel(model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/openai.ts
  return model.id.startsWith('gpt-')
}

/** Check if model supports web search in chat completion mode only */
export function isOpenAIWebSearchChatCompletionOnlyModel(_model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/openai.ts
  return false
}

/** Check if model is OpenAI deep research model */
export function isOpenAIDeepResearchModel(model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/openai.ts
  return model.id.includes('deep-research')
}

/** Check if model is an Anthropic/Claude model */
export function isAnthropicModel(model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/anthropic.ts
  return model.id.includes('claude')
}

/** Check if model is a Gemini model */
export function isGeminiModel(model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/google.ts
  return model.id.includes('gemini')
}

/** Check if model is Gemini 3 series */
export function isGemini3Model(model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/google.ts
  return model.id.includes('gemini-3')
}

/** Check if model supports vision/image input */
export function isVisionModel(_model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/
  return true // most modern models support vision
}

/** Check if model is a reasoning model (thinking/chain-of-thought) */
export function isReasoningModel(model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/
  return model.id.includes('o1') || model.id.includes('o3') || model.id.includes('deepseek-r1')
}

/** Check if model is Claude 4 series */
export function isClaude4SeriesModel(model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/anthropic.ts
  return model.id.includes('claude-4') || model.id.includes('claude-opus-4') || model.id.includes('claude-sonnet-4')
}

/** Check if model is Claude 4.5 reasoning */
export function isClaude45ReasoningModel(_model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/anthropic.ts
  return false
}

/** Check if model supports thinking token for Claude */
export function isSupportedThinkingTokenClaudeModel(model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/anthropic.ts
  return model.id.includes('claude-3') || model.id.includes('claude-4')
}

/** Check if model supports thinking token for Qwen */
export function isSupportedThinkingTokenQwenModel(model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/qwen.ts
  return model.id.includes('qwq') || model.id.includes('qwen3')
}

/** Check if model is Qwen 3.5-3.9 */
export function isQwen35to39Model(_model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/qwen.ts
  return false
}

/** Check if model supports reasoning effort for Grok */
export function isSupportedReasoningEffortGrokModel(_model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/xai.ts
  return false
}

/** Check if model is DeepSeek hybrid inference */
export function isDeepSeekHybridInferenceModel(_model: ModelLike): boolean {
  // TODO: migrate from src/renderer/src/config/models/deepseek.ts
  return false
}

/** Find token limit for a model */
export function findTokenLimit(_model: ModelLike): number | undefined {
  // TODO: migrate from src/renderer/src/config/models/
  return undefined
}
