/**
 * Format-keyed reasoning serializers (#16598) — the descriptor-driven
 * replacement for the legacy provider-id branch tower in `getReasoningEffort`.
 *
 * Dispatch: `model.reasoning.type` (a `ReasoningFormatType`, resolved from the
 * provider's endpoint declaration) selects the serializer; the catalog is
 * exhaustive over the format union (`satisfies` — adding a format type to the
 * schema fails compilation until its serializer exists).
 *
 * Three layers, mirroring the frozen tower semantics byte-for-byte:
 *  - WIRE_OVERLAYS — per-provider quirks that are NOT format-wide (poe's
 *    extra_body wrapping, silicon's 32768 budget floor + exhaustive return,
 *    together's effort remap). Checked before the format serializer, exactly
 *    where the tower's provider branches sat.
 *  - REASONING_SERIALIZERS — one entry per format type: the provider-dialect
 *    knowledge that Phase 3 moved into registry data (enable-thinking /
 *    thinking-type / dashscope / self-hosted / openrouter / none /
 *    disable-reasoning).
 *  - the FAMILY RESIDUE — model-family wire shapes that survive on generic
 *    OpenAI-compatible providers (claude thinking budgets, gemini
 *    thinking_config, qwen enable_thinking, …). Irreducible: on an unknown
 *    compat provider the MODEL determines the dialect. Shared as the fallback
 *    of every format serializer.
 *
 * Budgets are computed descriptor-first (`resolveBudgetTokens`) — the first
 * consumer to actually READ `model.reasoning.thinkingTokenLimits`.
 */
import type { ReasoningFormatType } from '@cherrystudio/provider-registry'
import { loggerService } from '@logger'
import { DEFAULT_MAX_TOKENS } from '@main/ai/constants'
import { resolveBudgetTokens, resolveEffortPlan } from '@shared/ai/reasoningPlan'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import {
  GEMINI_FLASH_MODEL_REGEX,
  getLowerBaseModelName,
  getModelSupportedReasoningEffortOptions,
  isDeepSeekHybridInferenceModel,
  isDeepSeekV4PlusModel,
  isDoubaoSeed18Model,
  isDoubaoSeedAfter251015,
  isDoubaoThinkingAutoModel,
  isGemini3ThinkingTokenModel,
  isGrok4FastReasoningModel,
  isMiniMaxModel,
  isOpenAIReasoningModel,
  isQwen35to39Model,
  isQwenAlwaysThinkModel,
  isQwenReasoningModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenClaudeModel,
  isSupportedThinkingTokenDoubaoModel,
  isSupportedThinkingTokenGeminiModel,
  isSupportedThinkingTokenHunyuanModel,
  isSupportedThinkingTokenKimiModel,
  isSupportedThinkingTokenMiMoModel,
  isSupportedThinkingTokenModel,
  isSupportedThinkingTokenQwenModel,
  isSupportedThinkingTokenZhipuModel,
  isSupportNoneReasoningEffortModel
} from '@shared/utils/model'
import { isSupportEnableThinkingProvider } from '@shared/utils/provider'
import { EFFORT_RATIO } from '@shared/utils/reasoning'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import { toInteger } from 'es-toolkit/compat'

import type { ReasoningEffortOptionalParams } from './reasoning'

const logger = loggerService.withContext('reasoningSerializers')

export interface SerializerContext {
  assistant: Assistant
  model: Model
  provider: Provider
  /** Validated positive effort (never 'none'/'default'). */
  effort: Exclude<ReasoningEffortOption, 'none' | 'default'>
  /** Whether the user selected 'none' (explicit off). */
  off: boolean
  /** Descriptor-first thinking budget for `effort` (undefined = unknown). */
  budgetTokens: number | undefined
  modelId: string
  rawModelId: string
}

type Serializer = (ctx: SerializerContext) => ReasoningEffortOptionalParams

// ── Family residue ───────────────────────────────────────────────────────────
// Model-family branches shared by every format (the tower body minus its
// provider-id branches), in the tower's exact order.

function residueOff(ctx: SerializerContext): ReasoningEffortOptionalParams {
  const { model, provider } = ctx
  if (
    isSupportEnableThinkingProvider(provider) &&
    (isSupportedThinkingTokenQwenModel(model) || isSupportedThinkingTokenHunyuanModel(model))
  ) {
    return { enable_thinking: false }
  }
  if (isSupportedThinkingTokenGeminiModel(model)) {
    if (GEMINI_FLASH_MODEL_REGEX.test(model.id)) {
      return { extra_body: { google: { thinking_config: { thinking_budget: 0 } } } }
    }
    logger.warn(`Model ${model.id} cannot disable reasoning. Fallback to empty reasoning param.`)
    return {}
  }
  if (
    isSupportedThinkingTokenDoubaoModel(model) ||
    isSupportedThinkingTokenZhipuModel(model) ||
    isSupportedThinkingTokenKimiModel(model)
  ) {
    return { thinking: { type: 'disabled' } }
  }
  if (isDeepSeekV4PlusModel(model)) {
    return { thinking: { type: 'disabled' } }
  }
  // MiniMax M3: thinking.type ∈ {adaptive, disabled} — no 'enabled', no budget
  // (platform.minimax.io text-openai-api / text-anthropic-api).
  if (isMiniMaxModel(model)) {
    return { thinking: { type: 'disabled' } }
  }
  if (isDeepSeekHybridInferenceModel(model)) {
    return {}
  }
  if (isSupportNoneReasoningEffortModel(model)) {
    return { reasoningEffort: 'none' }
  }
  if (isQwen35to39Model(model)) {
    return { chat_template_kwargs: { enable_thinking: false } }
  }
  if (ctx.modelId.includes('mistral-small-2603')) {
    return { reasoningEffort: 'none' }
  }
  logger.warn(`Model ${model.id} doesn't match any disable reasoning behavior. Fallback to empty reasoning param.`)
  return {}
}

/** DeepSeek v3.x hybrid — thinking switch differs per serving provider. */
function hybridDeepSeekPositive(providerId: string): ReasoningEffortOptionalParams {
  switch (providerId) {
    case SystemProviderIds.dashscope:
      return { enable_thinking: true, incremental_output: true }
    case SystemProviderIds['new-api']:
    case SystemProviderIds.cherryin:
      return { extra_body: { thinking: { type: 'enabled' } } }
    case SystemProviderIds.openrouter:
    case SystemProviderIds.together:
      return { reasoning: { enabled: true } }
    default:
      // hunyuan / tencent-cloud-ti / doubao / deepseek / aihubmix / sophnet /
      // ppio / dmxapi and every unknown provider: `thinking.type` (the shape
      // the legacy tower used both for its known list and its warned fallback).
      return { thinking: { type: 'enabled' } }
  }
}

function residuePositive(ctx: SerializerContext): ReasoningEffortOptionalParams {
  const { assistant, model, provider, effort, budgetTokens, modelId } = ctx

  if (isDeepSeekV4PlusModel(model)) {
    return {
      thinking: { type: 'enabled' as const },
      // Native vocabulary fidelity: 'max' rides verbatim ('xhigh' is the
      // legacy UI alias for the same tier); everything else collapses to
      // 'high' — the API only accepts high/max.
      reasoning_effort: effort === 'xhigh' || effort === 'max' ? 'max' : 'high'
    }
  }
  if (isDeepSeekHybridInferenceModel(model)) {
    return hybridDeepSeekPositive(provider.id)
  }
  if (isMiniMaxModel(model)) {
    return { thinking: { type: 'adaptive' } }
  }
  if (isQwenReasoningModel(model)) {
    const enableThinkingConfig = isQwenAlwaysThinkModel(model) ? {} : { enable_thinking: true }
    if (isSupportEnableThinkingProvider(provider)) {
      return { ...enableThinkingConfig, thinking_budget: budgetTokens }
    }
    return { chat_template_kwargs: { ...enableThinkingConfig, thinking_budget: budgetTokens } }
  }
  if (isSupportedThinkingTokenHunyuanModel(model) && isSupportEnableThinkingProvider(provider)) {
    return { enable_thinking: true }
  }
  // The effort-string dialect applies only to models with a REAL effort
  // control (or legacy descriptors predating `controls`). A toggle-derived
  // ['none','auto'] pair is NOT an effort vocabulary — treating it as one
  // used to hijack budget/toggle families (claude/gemini-flash/glm on compat
  // providers) into `reasoningEffort: none` (#16598 failure mode C).
  const hasEffortControl = model.reasoning?.controls?.some((c) => c.kind === 'effort') ?? false
  const hasLegacyVocabulary = !model.reasoning?.controls?.length && isSupportedReasoningEffortModel(model)
  if (hasEffortControl || hasLegacyVocabulary) {
    const supportedOptions = getModelSupportedReasoningEffortOptions(model)?.filter((option) => option !== 'default')
    if (supportedOptions?.includes(effort)) {
      return { reasoningEffort: effort }
    }
    // Out-of-vocabulary → first option (frozen legacy coercion; the UI's
    // reconcile ladder prevents this from being reachable going forward).
    return { reasoningEffort: supportedOptions?.[0] as ReasoningEffortOption | undefined }
  }
  if (modelId.includes('mistral-small-2603')) {
    return { reasoningEffort: 'high' }
  }
  if (isSupportedThinkingTokenGeminiModel(model)) {
    if (isGemini3ThinkingTokenModel(model)) {
      return { reasoningEffort: effort }
    }
    if (effort === 'auto') {
      return { extra_body: { google: { thinking_config: { thinking_budget: -1, include_thoughts: true } } } }
    }
    return {
      extra_body: { google: { thinking_config: { thinking_budget: budgetTokens ?? -1, include_thoughts: true } } }
    }
  }
  if (isSupportedThinkingTokenClaudeModel(model)) {
    const maxTokens = assistant.settings?.maxTokens
    const effortRatio = EFFORT_RATIO[effort]
    return {
      thinking: {
        type: 'enabled',
        budget_tokens: budgetTokens
          ? Math.floor(Math.max(1024, Math.min(budgetTokens, (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio)))
          : undefined
      }
    }
  }
  if (isSupportedThinkingTokenDoubaoModel(model)) {
    if (isDoubaoSeedAfter251015(model) || isDoubaoSeed18Model(model)) {
      return { reasoningEffort: effort }
    }
    if (effort === 'high') {
      return { thinking: { type: 'enabled' } }
    }
    if (effort === 'auto' && isDoubaoThinkingAutoModel(model)) {
      return { thinking: { type: 'auto' } }
    }
    return {}
  }
  if (isSupportedThinkingTokenZhipuModel(model)) {
    return { thinking: { type: 'enabled' } }
  }
  if (isSupportedThinkingTokenMiMoModel(model) || isSupportedThinkingTokenKimiModel(model)) {
    return { thinking: { type: 'enabled' } }
  }
  return {}
}

const residue: Serializer = (ctx) => (ctx.off ? residueOff(ctx) : residuePositive(ctx))

// ── Per-provider overlays ────────────────────────────────────────────────────
// Quirks narrower than a format. Return `undefined` to fall through to the
// format serializer. Ordering matches the legacy tower's provider branches.

type Overlay = (ctx: SerializerContext) => ReasoningEffortOptionalParams | undefined

const poeOverlay: Overlay = (ctx) => {
  if (ctx.off) return undefined // poe 'none' takes the shared family off-path
  const { model, effort, budgetTokens, assistant } = ctx
  if (isOpenAIReasoningModel(model)) {
    return { extra_body: { reasoning_effort: effort === 'auto' ? 'medium' : effort } }
  }
  if (isSupportedThinkingTokenClaudeModel(model)) {
    if (!budgetTokens) {
      logger.warn(
        `No token limit configuration found for Claude model "${model.id}" on Poe provider. ` +
          `Reasoning effort setting "${effort}" will not be applied.`
      )
      return {}
    }
    const maxTokens = assistant.settings?.maxTokens
    const effortRatio = EFFORT_RATIO[effort]
    const clamped = Math.floor(Math.max(1024, Math.min(budgetTokens, (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio)))
    return { extra_body: { thinking_budget: clamped } }
  }
  if (isSupportedThinkingTokenGeminiModel(model)) {
    if (!budgetTokens && effort !== 'auto') {
      logger.warn(
        `No token limit configuration found for Gemini model "${model.id}" on Poe provider. ` +
          `Using auto (-1) instead of requested effort "${effort}".`
      )
    }
    return { extra_body: { thinking_budget: effort === 'auto' ? -1 : (budgetTokens ?? -1) } }
  }
  logger.warn(
    `Poe provider reasoning model "${model.id}" does not match known categories ` +
      `(GPT-5, Claude, Gemini). Reasoning effort setting "${effort}" will not be applied.`
  )
  return {}
}

const siliconOverlay: Overlay = (ctx) => {
  const { model, budgetTokens } = ctx
  const knob =
    isDeepSeekHybridInferenceModel(model) ||
    isSupportedThinkingTokenZhipuModel(model) ||
    isSupportedThinkingTokenQwenModel(model) ||
    isSupportedThinkingTokenHunyuanModel(model)
  if (ctx.off) {
    return knob ? { enable_thinking: false } : undefined
  }
  if (knob) {
    return {
      enable_thinking: true,
      // SiliconFlow enforces a hard budget floor.
      thinking_budget: budgetTokens ? toInteger(Math.max(budgetTokens, 32_768)) : undefined
    }
  }
  return {} // silicon's branch is exhaustive: nothing else gets reasoning params
}

const togetherOverlay: Overlay = (ctx) => {
  const { model, effort } = ctx
  if (ctx.off) {
    if (
      isSupportEnableThinkingProvider(ctx.provider) &&
      (isSupportedThinkingTokenQwenModel(model) || isSupportedThinkingTokenHunyuanModel(model))
    ) {
      return { enable_thinking: false }
    }
    return { reasoning: { enabled: false } }
  }
  // DeepSeek shapes precede the remap, matching the tower's branch order.
  if (isDeepSeekV4PlusModel(model) || isDeepSeekHybridInferenceModel(model)) return undefined
  let adjusted: 'low' | 'medium' | 'high' = 'medium'
  switch (effort) {
    case 'minimal':
      adjusted = 'low'
      break
    case 'xhigh':
    case 'max':
      adjusted = 'high'
      break
    case 'auto':
      adjusted = 'medium'
      break
    default:
      adjusted = effort
      break
  }
  return { reasoningEffort: adjusted, reasoning: { enabled: true } }
}

export const REASONING_WIRE_OVERLAYS: Record<string, Overlay> = {
  [SystemProviderIds.poe]: poeOverlay,
  [SystemProviderIds.silicon]: siliconOverlay,
  [SystemProviderIds.together]: togetherOverlay
}

// ── Format serializers ───────────────────────────────────────────────────────

const openaiChat: Serializer = residue

const openaiResponses: Serializer = residue

/** Anthropic-dialect models reached over an OpenAI-compatible route. */
const anthropicCompat: Serializer = residue

/** Gemini-dialect models reached over an OpenAI-compatible route. */
const geminiCompat: Serializer = residue

const openrouter: Serializer = (ctx) => {
  const { model, effort } = ctx
  if (ctx.off) {
    if (isSupportNoneReasoningEffortModel(model)) {
      return { reasoning: { effort: 'none' } }
    }
    return { reasoning: { enabled: false, exclude: true } }
  }
  if (isGrok4FastReasoningModel(model)) {
    return { reasoning: { enabled: true } }
  }
  if (isSupportedReasoningEffortModel(model) || isSupportedThinkingTokenModel(model)) {
    return { reasoning: { effort: effort === 'auto' ? 'medium' : effort } }
  }
  return residue(ctx)
}

const enableThinking: Serializer = (ctx) => {
  if (ctx.off && (isSupportedThinkingTokenQwenModel(ctx.model) || isSupportedThinkingTokenHunyuanModel(ctx.model))) {
    return { enable_thinking: false }
  }
  return residue(ctx)
}

const thinkingType: Serializer = residue

const dashscope: Serializer = (ctx) => {
  const { model, budgetTokens } = ctx
  if (ctx.off) {
    if (
      isSupportedThinkingTokenQwenModel(model) ||
      isSupportedThinkingTokenHunyuanModel(model) ||
      isDeepSeekHybridInferenceModel(model) ||
      isSupportedThinkingTokenZhipuModel(model) ||
      isSupportedThinkingTokenKimiModel(model)
    ) {
      return { enable_thinking: false }
    }
    return residueOff(ctx)
  }
  if (isDeepSeekHybridInferenceModel(model) && !isDeepSeekV4PlusModel(model)) {
    return { enable_thinking: true, incremental_output: true }
  }
  // Qwen / GLM / Kimi on Bailian: on/off + budget, no effort levels.
  if (
    isQwenReasoningModel(model) ||
    isSupportedThinkingTokenZhipuModel(model) ||
    isSupportedThinkingTokenKimiModel(model)
  ) {
    return { enable_thinking: true, thinking_budget: budgetTokens }
  }
  return residue(ctx)
}

const selfHosted: Serializer = (ctx) => {
  const { model, budgetTokens } = ctx
  if (ctx.off) {
    if (isSupportedThinkingTokenQwenModel(model)) return { chat_template_kwargs: { enable_thinking: false } }
    if (isDeepSeekHybridInferenceModel(model)) return { chat_template_kwargs: { thinking: false } }
    if (isSupportedThinkingTokenKimiModel(model)) return { chat_template_kwargs: { thinking: false } }
    if (isSupportedThinkingTokenZhipuModel(model)) return { chat_template_kwargs: { enable_thinking: false } }
    return residueOff(ctx)
  }
  if (isSupportedThinkingTokenQwenModel(model)) {
    const enableThinkingConfig = isQwenAlwaysThinkModel(model) ? {} : { enable_thinking: true }
    return { chat_template_kwargs: { ...enableThinkingConfig, thinking_budget: budgetTokens } }
  }
  // v4+ included: a self-hosted template reads the kwarg, not DeepSeek's
  // official effort dialect.
  if (isDeepSeekHybridInferenceModel(model)) {
    return { chat_template_kwargs: { thinking: true } }
  }
  if (isSupportedThinkingTokenKimiModel(model)) {
    return { chat_template_kwargs: { thinking: true } }
  }
  if (isSupportedThinkingTokenZhipuModel(model)) {
    return { chat_template_kwargs: { enable_thinking: true } }
  }
  return residue(ctx)
}

/** Provider ignores/rejects reasoning params entirely (groq). */
const none: Serializer = () => ({})

/** Cerebras: off = `disable_reasoning`, GLM stays parameter-free when on. */
const disableReasoning: Serializer = (ctx) => {
  const { model } = ctx
  if (ctx.off) {
    if (
      isSupportEnableThinkingProvider(ctx.provider) &&
      (isSupportedThinkingTokenQwenModel(model) || isSupportedThinkingTokenHunyuanModel(model))
    ) {
      return { enable_thinking: false }
    }
    if (
      isSupportedThinkingTokenDoubaoModel(model) ||
      isSupportedThinkingTokenZhipuModel(model) ||
      isSupportedThinkingTokenKimiModel(model)
    ) {
      return { disable_reasoning: true }
    }
    return residueOff(ctx)
  }
  if (isSupportedThinkingTokenZhipuModel(model)) {
    return {}
  }
  return residue(ctx)
}

/**
 * The exhaustive format→serializer catalog. `satisfies` locks it to the
 * registry's format union: adding a format type to the schema is a compile
 * error here until its serializer exists.
 */
export const REASONING_SERIALIZERS = {
  'openai-chat': openaiChat,
  'openai-responses': openaiResponses,
  anthropic: anthropicCompat,
  gemini: geminiCompat,
  openrouter,
  'enable-thinking': enableThinking,
  'thinking-type': thinkingType,
  dashscope,
  'self-hosted': selfHosted,
  none,
  'disable-reasoning': disableReasoning
} as const satisfies Record<ReasoningFormatType, Serializer>

/**
 * Descriptor-driven entry point — replaces the legacy branch tower for every
 * model whose registry descriptor carries a format type. The pre-serializer
 * steps (capability gate, deep-research pin, default short-circuit) mirror
 * the tower head exactly.
 */
export function serializeReasoningEffort(
  assistant: Assistant,
  model: Model,
  provider: Provider,
  format: ReasoningFormatType
): ReasoningEffortOptionalParams {
  if (format === 'none') return {}

  const rawModelId = parseUniqueModelId(model.id).modelId
  const modelId = getLowerBaseModelName(rawModelId)

  const plan = resolveEffortPlan(assistant?.settings?.reasoning_effort)
  if (plan.kind === 'omit') return {}

  const ctx: SerializerContext = {
    assistant,
    model,
    provider,
    effort: plan.kind === 'effort' ? plan.effort : 'high',
    off: plan.kind === 'off',
    budgetTokens: plan.kind === 'effort' ? resolveBudgetTokens(plan.effort, model.reasoning) : undefined,
    modelId,
    rawModelId
  }

  const overlay = REASONING_WIRE_OVERLAYS[provider.id]
  if (overlay) {
    const result = overlay(ctx)
    if (result !== undefined) return result
  }

  return REASONING_SERIALIZERS[format](ctx)
}
