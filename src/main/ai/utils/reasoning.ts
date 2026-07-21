import type { BedrockProviderOptions } from '@ai-sdk/amazon-bedrock'
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { XaiResponsesProviderOptions } from '@ai-sdk/xai'
import type OpenAI from '@cherrystudio/openai'
import type { ReasoningEffort } from '@cherrystudio/provider-registry'
import { loggerService } from '@logger'
import {
  computeBudgetTokens,
  FALLBACK_TOKEN_LIMIT,
  getThinkingBudget as sharedGetThinkingBudget
} from '@shared/ai/reasoningBudget'
import { nearestThinkingOption } from '@shared/ai/reasoningVocabulary'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { OpenAIReasoningSummary, ReasoningEffortOption } from '@shared/types/aiSdk'
import {
  isAnthropicModel,
  isGeminiModel,
  isGrokModel,
  isHostedGemma4ThinkingModel,
  isMiniMaxModel,
  isOpenAIDeepResearchModel,
  isOpenAIModel,
  isOpenAIOpenWeightModel,
  isReasoningModel
} from '@shared/utils/model'
import { EFFORT_RATIO } from '@shared/utils/reasoning'
import type { OllamaProviderOptions } from 'ollama-ai-provider-v2'

import { serializeReasoningEffort } from './reasoningSerializers'

const logger = loggerService.withContext('reasoning')

export type ReasoningEffortOptionalParams = {
  thinking?: { type: 'disabled' | 'enabled' | 'auto' | 'adaptive'; budget_tokens?: number }
  reasoning?: { max_tokens?: number; exclude?: boolean; effort?: string; enabled?: boolean } | OpenAI.Reasoning
  reasoningEffort?: ReasoningEffortOption
  // WARN: This field will be overwrite to undefined by aisdk if the provider is openai-compatible. Use reasoningEffort instead.
  reasoning_effort?: ReasoningEffortOption
  enable_thinking?: boolean
  thinking_budget?: number
  incremental_output?: boolean
  enable_reasoning?: boolean
  // nvidia, etc.
  chat_template_kwargs?: {
    thinking?: boolean
    enable_thinking?: boolean
    thinking_budget?: number
  }
  extra_body?: {
    google?: {
      thinking_config: {
        thinking_budget: number
        include_thoughts?: boolean
      }
    }
    thinking?: {
      type: 'enabled' | 'disabled'
    }
    thinking_budget?: number
    reasoning_effort?: ReasoningEffortOption
  }
  disable_reasoning?: boolean
  // Add any other potential reasoning-related keys here if they exist
}

/**
 * Reasoning params for the generic (OpenAI-compatible) request path.
 *
 * Descriptor-driven dispatch (#16598): models whose registry descriptor
 * carries a reasoning format type route through the format-keyed serializer
 * catalog (`reasoningSerializers.ts`); descriptor-less models carry no knobs
 * and get no params (the legacy branch tower is gone).
 */
export function getReasoningEffort(
  assistant: Assistant,
  model: Model,
  provider: Provider
): ReasoningEffortOptionalParams {
  const format = model.reasoning?.type
  if (format) {
    // Head order mirrors the legacy tower: groq's data-declared 'none' format
    // wins over everything; deep research pins medium before effort parsing.
    if (format === 'none') return {}
    if (!isReasoningModel(model)) return {}
    if (isOpenAIDeepResearchModel(model)) return { reasoning_effort: 'medium' }
    return serializeReasoningEffort(assistant, model, provider, format)
  }
  // No descriptor = no knobs to inject. Descriptor-less rows are fixed
  // reasoners (no controls) or ids the ingest heuristics don't know — the UI
  // renders them knob-less, so there is no choice to serialize (the deleted
  // legacy tower only ever emitted no-op affirmations for these).
  return {}
}

/**
 * Get OpenAI reasoning parameters. For official OpenAI provider only.
 * Descriptor-driven (#16598): the effort-control gate replaces the vendor
 * regex tables, and the sent tier is resolved against the declared
 * vocabulary (deep-research's ['medium'] pins itself; stale values coerce
 * to the nearest declared tier).
 */
export function getOpenAIReasoningParams(
  assistant: Assistant,
  model: Model,
  openAISettings?: { summaryText?: OpenAIReasoningSummary }
): Pick<OpenAIResponsesProviderOptions, 'reasoningEffort' | 'reasoningSummary'> {
  if (!isReasoningModel(model)) {
    return {}
  }

  let reasoningEffort = assistant?.settings?.reasoning_effort

  if (!reasoningEffort || reasoningEffort === 'default') {
    return {}
  }

  if (reasoningEffort === 'auto') {
    reasoningEffort = 'medium'
  }

  // 非OpenAI模型，但是Provider类型是responses/azure openai的情况
  if (!isOpenAIModel(model)) {
    return {
      reasoningEffort
    }
  }

  if (!hasEffortControl(model)) {
    return {}
  }

  const control = model.reasoning?.controls?.find((c) => c.kind === 'effort')
  const resolved = resolveNativeEffort(model, reasoningEffort, control?.values ?? [])
  if (!resolved) {
    return {}
  }

  // o1-pro rejects reasoning summaries.
  const reasoningSummary = model.id.includes('o1-pro') ? undefined : openAISettings?.summaryText

  return {
    reasoningEffort: resolved,
    reasoningSummary
  }
}

/**
 * Resolve the user's chosen effort against the model's DECLARED effort
 * vocabulary, clamped to the wire's accepted tiers (#16598): in-vocabulary
 * values ride verbatim; stale persisted values coerce to the nearest declared
 * tier (`nearestThinkingOption`, ties break upward). Returns `undefined` when
 * the model declares no effort control or none of its tiers fit the wire.
 */
function resolveNativeEffort<T extends string>(model: Model, chosen: string, allowed: readonly T[]): T | undefined {
  const control = model.reasoning?.controls?.find((c) => c.kind === 'effort')
  if (!control) return undefined
  const candidates = control.values.filter((v): v is ReasoningEffort & T => (allowed as readonly string[]).includes(v))
  if (candidates.length === 0) return undefined
  if ((candidates as readonly string[]).includes(chosen)) return chosen as T
  // OFF must never coerce to an ON tier: a model whose vocabulary can't
  // express 'none' simply omits the knob.
  if (chosen === 'none') return undefined
  return nearestThinkingOption(chosen, candidates as readonly ReasoningEffortOption[]) as T | undefined
}

function hasEffortControl(model: Model): boolean {
  return model.reasoning?.controls?.some((c) => c.kind === 'effort') ?? false
}

/**
 * Main-side thinking budget: DESCRIPTOR-FIRST (#16598) — reads the model's
 * registry `thinkingTokenLimits` when present, falling back to the shared
 * regex-table lookup for descriptor-less models. Strict (no-fallback)
 * variant: unknown models return `undefined`. The renderer Code page calls
 * the shared function directly with `{ fallbackOnUnknown: true }`.
 */
export function getThinkingBudget(
  maxTokens: number | undefined,
  reasoningEffort: string | undefined,
  model: Model
): number | undefined {
  if (reasoningEffort === undefined || reasoningEffort === 'none') return undefined
  const limits = model.reasoning?.thinkingTokenLimits
  if (limits?.min != null && limits.max != null) {
    const ratio = EFFORT_RATIO[reasoningEffort as keyof typeof EFFORT_RATIO] ?? EFFORT_RATIO.high
    return computeBudgetTokens({ min: limits.min, max: limits.max }, ratio, maxTokens)
  }
  return sharedGetThinkingBudget(maxTokens, reasoningEffort, model.id, EFFORT_RATIO)
}

// Compute a fallback budgetTokens using a conservative token limit when
// findTokenLimit() cannot determine the model's actual limit. This ensures
// { type: 'enabled' } always carries a valid budget, which is required by
// the Claude Agent SDK and the Anthropic Messages API.
function getFallbackBudgetTokens(reasoningEffort: string | undefined): number {
  const effortRatio = EFFORT_RATIO[reasoningEffort ?? 'high'] ?? EFFORT_RATIO.high
  return computeBudgetTokens(FALLBACK_TOKEN_LIMIT, effortRatio)
}

/**
 * Get Anthropic reasoning parameters — descriptor-driven (#16598).
 *
 * Knobs come from the model's declared controls; the wire envelope is dialect
 * knowledge; the ONLY vendor residue is the `isAnthropicModel` family test —
 * knob shape alone cannot distinguish Claude's adaptive generations from a
 * compat-served model that also declares an effort control (e.g. kimi-k3).
 *
 * - Anthropic model WITH an effort control (4.6+/5.x/Fable): adaptive
 *   thinking + the declared vocabulary verbatim (stale persisted values
 *   coerce to the nearest declared tier). `display: 'summarized'` — the API
 *   defaults to 'omitted', which would break Cherry's thinking UI.
 * - Anthropic model without one (≤4.5): enabled + explicit budget.
 * - Non-Anthropic models over the Claude wire (DeepSeek V4, Kimi, MiniMax):
 *   enabled envelope + `sendReasoning`; budget only when the descriptor
 *   declares limits (no fabricated numbers); a declared effort vocabulary
 *   rides verbatim — DeepSeek documents `output_config.effort` (levels
 *   low…xhigh…max are DISTINCT), other compat endpoints tolerate the field.
 */
const ANTHROPIC_EFFORT_TIERS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export function getAnthropicReasoningParams(
  assistant: Assistant,
  model: Model
): {
  thinking?: AnthropicProviderOptions['thinking']
  effort?: AnthropicProviderOptions['effort']
  sendReasoning?: AnthropicProviderOptions['sendReasoning']
} {
  if (!isReasoningModel(model)) {
    return {}
  }

  const reasoningEffort = assistant?.settings?.reasoning_effort
  const isAdaptiveClaude = isAnthropicModel(model) && hasEffortControl(model)
  // MiniMax speaks thinking.type ∈ {adaptive, disabled} — no 'enabled', no
  // budget; its anthropic surface defaults to OFF, so the explicit adaptive
  // envelope carries both the on-tiers and the auto default.
  const isMiniMaxToggle =
    isMiniMaxModel(model) && (model.reasoning?.controls?.some((c) => c.kind === 'toggle') ?? false)

  if (!reasoningEffort || reasoningEffort === 'default') {
    // default IS auto: adaptive-generation Claude gets the explicit
    // "model decides" envelope (Opus 4.7/4.8 default to OFF without it);
    // MiniMax M3 likewise (its anthropic surface defaults thinking off);
    // everywhere else, sending nothing is the auto behavior.
    if (isAdaptiveClaude) return { thinking: { type: 'adaptive', display: 'summarized' } }
    if (isMiniMaxToggle) return { thinking: { type: 'adaptive' }, sendReasoning: true }
    return {}
  }

  if (reasoningEffort === 'none') {
    return {
      thinking: {
        type: 'disabled'
      }
    }
  }

  // Stale persisted 'auto' — same envelope-only semantics as default.
  const effort =
    reasoningEffort === 'auto' ? undefined : resolveNativeEffort(model, reasoningEffort, ANTHROPIC_EFFORT_TIERS)

  if (isAnthropicModel(model)) {
    if (isAdaptiveClaude) {
      const thinking = { type: 'adaptive', display: 'summarized' } as const
      return effort ? { thinking, effort } : { thinking }
    }

    // Pre-adaptive Claude: enabled + explicit token budget (the Messages API
    // requires budget_tokens with type 'enabled').
    const budgetTokens = getThinkingBudget(assistant.settings?.maxTokens, reasoningEffort, model)
    return {
      thinking: {
        type: 'enabled',
        budgetTokens: budgetTokens ?? getFallbackBudgetTokens(reasoningEffort)
      }
    }
  }

  // Non-Anthropic models served over the Claude wire.
  if (isMiniMaxToggle) {
    return { thinking: { type: 'adaptive' }, sendReasoning: true }
  }

  // Effort-driven models with no declared budget (DeepSeek V4): the effort
  // field alone, exactly like DeepSeek's own docs — no thinking envelope.
  // Sending `type: 'enabled'` without a budget makes @ai-sdk/anthropic
  // backfill `budget_tokens: 1024`, actively capping the model's thinking.
  if (hasEffortControl(model) && model.reasoning?.thinkingTokenLimits == null) {
    return {
      sendReasoning: true,
      ...(effort ? { effort } : {})
    }
  }

  // Budget/toggle models (Kimi, MiniMax, DeepSeek V3.x hybrids) need the
  // enabled marker to switch thinking on, and the wire requires a budget
  // with it — descriptor limits first, effort-scaled fallback otherwise
  // (better than the SDK's flat 1024 backfill).
  const budgetTokens = getThinkingBudget(assistant.settings?.maxTokens, reasoningEffort, model)
  return {
    thinking: {
      type: 'enabled',
      budgetTokens: budgetTokens ?? getFallbackBudgetTokens(reasoningEffort)
    },
    sendReasoning: true,
    ...(effort ? { effort } : {})
  }
}

type GoogleThinkingLevel = NonNullable<GoogleGenerativeAIProviderOptions['thinkingConfig']>['thinkingLevel']

const GEMINI_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const

/**
 * 获取 Gemini 推理参数 — descriptor-driven (#16598).
 *
 * Path selection comes from the model's declared knobs:
 *  - effort control (gemini-3.x / gemma-4) → `thinkingLevel`: declared
 *    vocabulary verbatim, stale values to the nearest declared tier — the
 *    old gemini-3-pro "minimal→low" bump falls out of pro's low-floored
 *    vocabulary; 'none' resolves through 'minimal' the same way.
 *  - budget-only (gemini-2.5) → `thinkingBudget` from the descriptor's
 *    declared limits; hard-off (budget 0) only when a toggle is declared.
 * 注意：Gemini/GCP 端点所使用的 thinkingBudget 等参数应该按照驼峰命名法传递
 * 而在 Google 官方提供的 OpenAI 兼容端点中则使用蛇形命名法 thinking_budget
 */
export function getGeminiReasoningParams(
  assistant: Assistant,
  model: Model
): Pick<GoogleGenerativeAIProviderOptions, 'thinkingConfig'> {
  if (!isReasoningModel(model)) {
    return {}
  }

  const reasoningEffort = assistant?.settings?.reasoning_effort as ReasoningEffortOption | undefined

  // Vendor residue (dispatch defense): this builder only speaks the Gemini
  // thinkingConfig surface.
  if (!isGeminiModel(model) && !isHostedGemma4ThinkingModel(model)) {
    return {}
  }

  const limits = model.reasoning?.thinkingTokenLimits

  if (!reasoningEffort || reasoningEffort === 'default') {
    // default IS auto: dynamic thinking with VISIBLE thoughts. Sending
    // nothing would leave include_thoughts off — the model still thinks but
    // Cherry's thinking UI gets no text. Gemma keeps the bare default (its
    // hosted surface has no dynamic mode).
    if (isHostedGemma4ThinkingModel(model)) return {}
    if (hasEffortControl(model)) {
      return { thinkingConfig: { includeThoughts: true } }
    }
    if (limits?.min != null && limits.max != null) {
      return { thinkingConfig: { includeThoughts: true, thinkingBudget: -1 } }
    }
    return {}
  }

  if (hasEffortControl(model)) {
    // Vendor residue: hosted Gemma 4 has no hard-off — 'minimal' means
    // "don't think", so thoughts are only included on the high tier.
    const isGemma = isHostedGemma4ThinkingModel(model)

    if (reasoningEffort === 'auto') {
      return { thinkingConfig: { includeThoughts: true, thinkingLevel: undefined } }
    }
    const target = reasoningEffort === 'none' ? 'minimal' : reasoningEffort
    const thinkingLevel: GoogleThinkingLevel = resolveNativeEffort(model, target, GEMINI_THINKING_LEVELS)
    const includeThoughts = isGemma ? thinkingLevel === 'high' : reasoningEffort !== 'none'
    return {
      thinkingConfig: {
        includeThoughts,
        thinkingLevel
      }
    }
  }

  if (limits?.min == null || limits.max == null) {
    return {}
  }

  const includeThoughts = reasoningEffort !== 'none'

  if (reasoningEffort === 'auto') {
    return {
      thinkingConfig: {
        includeThoughts,
        thinkingBudget: -1
      }
    }
  }

  if (reasoningEffort === 'none') {
    const hasToggle = model.reasoning?.controls?.some((c) => c.kind === 'toggle') ?? false
    return {
      thinkingConfig: {
        includeThoughts,
        ...(hasToggle ? { thinkingBudget: 0 } : {})
      }
    }
  }

  const effortRatio = EFFORT_RATIO[reasoningEffort]
  const budget = Math.floor((limits.max - limits.min) * effortRatio + limits.min)

  return {
    thinkingConfig: {
      includeThoughts,
      ...(budget > 0 ? { thinkingBudget: budget } : {})
    }
  }
}

/**
 * Get XAI-specific reasoning parameters — descriptor-driven (#16598): the
 * declared effort vocabulary (e.g. grok-4.3's none/low/medium/high, declared
 * in the xai creator) rides verbatim, stale values coerce to the nearest
 * declared tier; clamped to the responses enum ('none' comes from the
 * #15137 @ai-sdk/xai patch and disables reasoning).
 */
const XAI_EFFORT_TIERS = ['none', 'low', 'medium', 'high'] as const

export function getXAIReasoningParams(
  assistant: Assistant,
  model: Model
): Pick<XaiResponsesProviderOptions, 'reasoningEffort'> {
  // Vendor residue (dispatch defense): grok only.
  if (!isGrokModel(model) || !isReasoningModel(model) || !hasEffortControl(model)) {
    return {}
  }

  const reasoningEffort = assistant.settings?.reasoning_effort
  if (!reasoningEffort || reasoningEffort === 'default' || reasoningEffort === 'auto') return {}

  const effort = resolveNativeEffort(model, reasoningEffort, XAI_EFFORT_TIERS)
  if (!effort) {
    logger.debug('xai dropping reasoning effort with no declared tier', { reasoningEffort, modelId: model.id })
    return {}
  }
  return { reasoningEffort: effort }
}

/**
 * Get Bedrock reasoning parameters — descriptor-driven (#16598); Claude
 * models only (Bedrock's reasoningConfig is the Claude thinking surface).
 * Adaptive gate and vocabulary handling mirror getAnthropicReasoningParams;
 * the installed SDK's maxReasoningEffort enum includes every tier
 * (low…xhigh…max), so the declared vocabulary rides verbatim.
 */
export function getBedrockReasoningParams(
  assistant: Assistant,
  model: Model
): Pick<BedrockProviderOptions, 'reasoningConfig'> {
  if (!isReasoningModel(model)) {
    return {}
  }

  const reasoningEffort = assistant?.settings?.reasoning_effort
  const isAdaptiveClaude = isAnthropicModel(model) && hasEffortControl(model)

  if (reasoningEffort === undefined || reasoningEffort === 'default') {
    // default IS auto — see getAnthropicReasoningParams.
    return isAdaptiveClaude ? { reasoningConfig: { type: 'adaptive' } } : {}
  }

  if (reasoningEffort === 'none') {
    return {
      reasoningConfig: {
        type: 'disabled'
      }
    }
  }

  if (!isAnthropicModel(model)) {
    return {}
  }

  if (isAdaptiveClaude) {
    const maxReasoningEffort =
      reasoningEffort === 'auto' ? undefined : resolveNativeEffort(model, reasoningEffort, ANTHROPIC_EFFORT_TIERS)
    return maxReasoningEffort
      ? { reasoningConfig: { type: 'adaptive', maxReasoningEffort } }
      : { reasoningConfig: { type: 'adaptive' } }
  }

  // Pre-adaptive Claude: enabled + explicit budget.
  const maxTokens = assistant.settings?.maxTokens
  const budgetTokens = getThinkingBudget(maxTokens, reasoningEffort, model)
  return {
    reasoningConfig: {
      type: 'enabled',
      budgetTokens: budgetTokens
    }
  }
}

/**
 * Get Ollama reasoning parameters — descriptor-driven (#16598): a declared
 * effort vocabulary intersecting Ollama's string levels (gpt-oss) sends the
 * tier verbatim / nearest; every other reasoning model uses the boolean
 * `think` switch.
 */
const OLLAMA_THINK_LEVELS = ['low', 'medium', 'high'] as const

export function getOllamaReasoningParams(assistant: Assistant, model: Model): Pick<OllamaProviderOptions, 'think'> {
  const reasoningEffort = assistant.settings?.reasoning_effort

  // Vendor residue: Ollama's string think levels are a gpt-oss surface.
  if (
    isOpenAIOpenWeightModel(model) &&
    reasoningEffort &&
    reasoningEffort !== 'default' &&
    reasoningEffort !== 'none' &&
    reasoningEffort !== 'auto'
  ) {
    const level = resolveNativeEffort(model, reasoningEffort, OLLAMA_THINK_LEVELS)
    if (level) return { think: level }
  }

  if (reasoningEffort === 'none') return { think: false }
  return { think: true }
}

/**
 * 获取自定义参数
 * 从 assistant 设置中提取自定义参数
 */
export function getCustomParameters(assistant: Assistant): Record<string, any> {
  return (
    assistant?.settings?.customParameters?.reduce((acc, param) => {
      if (!param.name?.trim()) {
        return acc
      }
      // Parse JSON type parameters
      // The UI stores JSON type params as strings (e.g., '{"key":"value"}'),
      // so parse them into objects before sending to the API.
      if (param.type === 'json') {
        const value = param.value as string
        if (value === 'undefined') {
          return { ...acc, [param.name]: undefined }
        }
        try {
          return { ...acc, [param.name]: JSON.parse(value) }
        } catch {
          return { ...acc, [param.name]: value }
        }
      }
      return {
        ...acc,
        [param.name]: param.value
      }
    }, {}) || {}
  )
}

/**
 * Get reasoning tag name based on model ID
 * Used for extractReasoningMiddleware configuration
 */
export function getReasoningTagName(modelId: string | undefined): string {
  const tagName = {
    reasoning: 'reasoning',
    think: 'think',
    thought: 'thought',
    seedThink: 'seed:think'
  }

  if (modelId?.includes('gpt-oss')) return tagName.reasoning
  if (modelId?.includes('gemini')) return tagName.thought
  if (modelId?.includes('seed-oss-36b')) return tagName.seedThink
  return tagName.think
}
