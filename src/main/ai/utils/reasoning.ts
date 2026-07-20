import type { BedrockProviderOptions } from '@ai-sdk/amazon-bedrock'
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { XaiResponsesProviderOptions } from '@ai-sdk/xai'
import type OpenAI from '@cherrystudio/openai'
import type { OpenAIReasoningEffort, ReasoningEffort } from '@cherrystudio/provider-registry'
import { loggerService } from '@logger'
import { DEFAULT_MAX_TOKENS } from '@main/ai/constants'
import {
  computeBudgetTokens,
  FALLBACK_TOKEN_LIMIT,
  getThinkingBudget as sharedGetThinkingBudget
} from '@shared/ai/reasoningBudget'
import { nearestThinkingOption } from '@shared/ai/reasoningVocabulary'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { OpenAIReasoningSummary, ReasoningEffortOption } from '@shared/types/aiSdk'
import {
  findTokenLimit,
  GEMINI_FLASH_MODEL_REGEX,
  getLowerBaseModelName,
  getModelSupportedReasoningEffortOptions,
  isAnthropicModel,
  isDeepSeekHybridInferenceModel,
  isDeepSeekV4PlusModel,
  isDoubaoSeed18Model,
  isDoubaoSeedAfter251015,
  isDoubaoThinkingAutoModel,
  isGemini3ThinkingTokenModel,
  isGeminiModel,
  isGrok4FastReasoningModel,
  isGrokModel,
  isHostedGemma4ThinkingModel,
  isOpenAIDeepResearchModel,
  isOpenAIModel,
  isOpenAIOpenWeightModel,
  isOpenAIReasoningModel,
  isQwen35to39Model,
  isQwenAlwaysThinkModel,
  isQwenReasoningModel,
  isReasoningModel,
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
import { isSystemProviderId, SystemProviderIds } from '@shared/utils/systemProviderId'
import { toInteger } from 'es-toolkit/compat'
import type { OllamaProviderOptions } from 'ollama-ai-provider-v2'

import { serializeReasoningEffort } from './reasoningSerializers'

const logger = loggerService.withContext('reasoning')

export type ReasoningEffortOptionalParams = {
  thinking?: { type: 'disabled' | 'enabled' | 'auto'; budget_tokens?: number }
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
 * catalog (`reasoningSerializers.ts`); descriptor-less models (fixed-reasoning
 * SKUs, rows predating ingest inference) fall back to the legacy branch tower
 * below until Phase 6 deletes it.
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
  return legacyGetReasoningEffort(assistant, model, provider)
}

// The legacy provider-id branch tower — reached only for descriptor-less
// models; deleted in the final migration phase once the fallback hit rate is
// provably zero. Do NOT extend: new knowledge goes into the registry data +
// serializer catalog.
function legacyGetReasoningEffort(
  assistant: Assistant,
  model: Model,
  provider: Provider
): ReasoningEffortOptionalParams {
  const rawModelId = parseUniqueModelId(model.id).modelId
  const modelId = getLowerBaseModelName(rawModelId)
  if (provider.id === 'groq') {
    return {}
  }

  if (!isReasoningModel(model)) {
    return {}
  }

  if (isOpenAIDeepResearchModel(model)) {
    return {
      reasoning_effort: 'medium'
    }
  }
  const reasoningEffort = assistant?.settings?.reasoning_effort as ReasoningEffortOption | undefined

  // reasoningEffort is not set, no extra reasoning setting
  // Generally, for every model which supports reasoning control, the reasoning effort won't be undefined.
  // It's for some reasoning models that don't support reasoning control, such as deepseek reasoner.
  if (!reasoningEffort || reasoningEffort === 'default') {
    return {}
  }

  // Handle 'none' reasoningEffort. It's explicitly off.
  if (reasoningEffort === 'none') {
    // openrouter: use reasoning
    if (model.providerId === SystemProviderIds.openrouter) {
      if (isSupportNoneReasoningEffortModel(model) && reasoningEffort === 'none') {
        return { reasoning: { effort: 'none' } }
      }
      return { reasoning: { enabled: false, exclude: true } }
    }

    // nvidia: must use chat_template_kwargs
    // Since limited documentation, it's hard to find what parameters should be set
    // only part of mainstream oss model covered, all verified by nvidia api
    if (model.providerId === SystemProviderIds.nvidia) {
      if (isSupportedThinkingTokenQwenModel(model)) {
        return { chat_template_kwargs: { enable_thinking: false } }
      } else if (isDeepSeekHybridInferenceModel(model)) {
        return { chat_template_kwargs: { thinking: false } }
      } else if (isSupportedThinkingTokenKimiModel(model)) {
        return { chat_template_kwargs: { thinking: false } }
      } else if (isSupportedThinkingTokenZhipuModel(model)) {
        return { chat_template_kwargs: { enable_thinking: false } }
      }
    }

    // providers that use enable_thinking
    if (
      (isSupportEnableThinkingProvider(provider) &&
        (isSupportedThinkingTokenQwenModel(model) || isSupportedThinkingTokenHunyuanModel(model))) ||
      (provider.id === SystemProviderIds.dashscope &&
        (isDeepSeekHybridInferenceModel(model) ||
          isSupportedThinkingTokenZhipuModel(model) ||
          isSupportedThinkingTokenKimiModel(model))) ||
      // SiliconFlow uses enable_thinking for DeepSeek and Zhipu models, same as positive path
      (provider.id === SystemProviderIds.silicon &&
        (isDeepSeekHybridInferenceModel(model) || isSupportedThinkingTokenZhipuModel(model)))
    ) {
      return { enable_thinking: false }
    }

    // together
    if (provider.id === SystemProviderIds.together) {
      return { reasoning: { enabled: false } }
    }

    // gemini
    if (isSupportedThinkingTokenGeminiModel(model)) {
      if (GEMINI_FLASH_MODEL_REGEX.test(model.id)) {
        return {
          extra_body: {
            google: {
              thinking_config: {
                thinking_budget: 0
              }
            }
          }
        }
      } else {
        logger.warn(`Model ${model.id} cannot disable reasoning. Fallback to empty reasoning param.`)
        return {}
      }
    }

    // use thinking, doubao, zhipu, etc.
    if (
      isSupportedThinkingTokenDoubaoModel(model) ||
      isSupportedThinkingTokenZhipuModel(model) ||
      isSupportedThinkingTokenKimiModel(model)
    ) {
      if (provider.id === SystemProviderIds.cerebras) {
        return {
          disable_reasoning: true
        }
      }
      return { thinking: { type: 'disabled' } }
    }

    // DeepSeek V4+ defaults to thinking enabled, explicitly disable it
    if (isDeepSeekV4PlusModel(model)) {
      return { thinking: { type: 'disabled' } }
    }

    // DeepSeek V3.x hybrid, default behavior is non-thinking
    if (isDeepSeekHybridInferenceModel(model)) {
      return {}
    }

    // GPT 5.1, GPT 5.2, or newer
    if (isSupportNoneReasoningEffortModel(model)) {
      return {
        reasoningEffort: 'none'
      }
    }

    // Qwen 3.5 without direct enable_thinking
    // https://huggingface.co/Qwen/Qwen3.5-397B-A17B#instruct-or-non-thinking-mode
    if (isQwen35to39Model(model)) {
      return {
        chat_template_kwargs: {
          enable_thinking: false
        }
      }
    }

    // Mistral Small models: reasoningEffort 'none'
    if (modelId.includes('mistral-small-2603')) {
      return { reasoningEffort: 'none' }
    }

    logger.warn(`Model ${model.id} doesn't match any disable reasoning behavior. Fallback to empty reasoning param.`)
    return {}
  }

  // reasoningEffort有效的情况
  // https://creator.poe.com/docs/external-applications/openai-compatible-api#additional-considerations
  // Poe provider - supports custom bot parameters via extra_body
  if (provider.id === SystemProviderIds.poe) {
    if (isOpenAIReasoningModel(model)) {
      return {
        extra_body: {
          reasoning_effort: reasoningEffort === 'auto' ? 'medium' : reasoningEffort
        }
      }
    }

    // Claude models use thinking_budget parameter in extra_body
    if (isSupportedThinkingTokenClaudeModel(model)) {
      const effortRatio = EFFORT_RATIO[reasoningEffort]
      const tokenLimit = findTokenLimit(rawModelId)
      const maxTokens = assistant.settings?.maxTokens

      if (!tokenLimit) {
        logger.warn(
          `No token limit configuration found for Claude model "${model.id}" on Poe provider. ` +
            `Reasoning effort setting "${reasoningEffort}" will not be applied.`
        )
        return {}
      }

      let budgetTokens = Math.floor((tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min)
      budgetTokens = Math.floor(Math.max(1024, Math.min(budgetTokens, (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio)))

      return {
        extra_body: {
          thinking_budget: budgetTokens
        }
      }
    }

    // Gemini models use thinking_budget parameter in extra_body
    if (isSupportedThinkingTokenGeminiModel(model)) {
      const effortRatio = EFFORT_RATIO[reasoningEffort]
      const tokenLimit = findTokenLimit(rawModelId)
      let budgetTokens: number | undefined
      if (tokenLimit && reasoningEffort !== 'auto') {
        budgetTokens = Math.floor((tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min)
      } else if (!tokenLimit && reasoningEffort !== 'auto') {
        logger.warn(
          `No token limit configuration found for Gemini model "${model.id}" on Poe provider. ` +
            `Using auto (-1) instead of requested effort "${reasoningEffort}".`
        )
      }
      return {
        extra_body: {
          thinking_budget: budgetTokens ?? -1
        }
      }
    }

    // Poe reasoning model not in known categories (GPT-5, Claude, Gemini)
    logger.warn(
      `Poe provider reasoning model "${model.id}" does not match known categories ` +
        `(GPT-5, Claude, Gemini). Reasoning effort setting "${reasoningEffort}" will not be applied.`
    )
    return {}
  }

  // OpenRouter models
  if (model.providerId === SystemProviderIds.openrouter) {
    // Grok 4 Fast doesn't support effort levels, always use enabled: true
    if (isGrok4FastReasoningModel(model)) {
      return {
        reasoning: {
          enabled: true // Ignore effort level, just enable reasoning
        }
      }
    }

    // Other OpenRouter models that support effort levels
    if (isSupportedReasoningEffortModel(model) || isSupportedThinkingTokenModel(model)) {
      return {
        reasoning: {
          effort: reasoningEffort === 'auto' ? 'medium' : reasoningEffort
        }
      }
    }
  }

  const effortRatio = EFFORT_RATIO[reasoningEffort]
  const tokenLimit = findTokenLimit(modelId)
  let budgetTokens: number | undefined
  if (tokenLimit) {
    budgetTokens = Math.floor((tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min)
  }

  // nvidia: must use chat_template_kwargs
  // Since limited documentation, it's hard to find what parameters should be set
  // only part of mainstream oss model covered, all verified by nvidia api
  if (model.providerId === SystemProviderIds.nvidia) {
    if (isSupportedThinkingTokenQwenModel(model)) {
      const enableThinkingConfig = isQwenAlwaysThinkModel(model) ? {} : { enable_thinking: true }
      return {
        chat_template_kwargs: {
          ...enableThinkingConfig,
          thinking_budget: budgetTokens
        }
      }
    } else if (isDeepSeekHybridInferenceModel(model)) {
      return { chat_template_kwargs: { thinking: true } }
    } else if (isSupportedThinkingTokenKimiModel(model)) {
      return { chat_template_kwargs: { thinking: true } }
    } else if (isSupportedThinkingTokenZhipuModel(model)) {
      return { chat_template_kwargs: { enable_thinking: true } }
    }
  }

  // See https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions
  if (model.providerId === SystemProviderIds.silicon) {
    if (
      isDeepSeekHybridInferenceModel(model) ||
      isSupportedThinkingTokenZhipuModel(model) ||
      isSupportedThinkingTokenQwenModel(model) ||
      isSupportedThinkingTokenHunyuanModel(model)
    ) {
      return {
        enable_thinking: true,
        // Hard-encoded maximum, only for silicon
        thinking_budget: budgetTokens ? toInteger(Math.max(budgetTokens, 32768)) : undefined
      }
    }
    return {}
  }

  // DeepSeek V4+ models support reasoning_effort: "high" | "max" alongside thinking control
  // UI uses "xhigh" which maps to API's "max"; all other effort levels map to "high"
  if (isDeepSeekV4PlusModel(model)) {
    return {
      thinking: { type: 'enabled' as const },
      reasoning_effort: reasoningEffort === 'xhigh' ? ('max' as OpenAIReasoningEffort) : 'high'
    }
  }

  // DeepSeek hybrid inference models, v3.1 and maybe more in the future
  // 不同的 provider 有不同的思考控制方式，在这里统一解决
  if (isDeepSeekHybridInferenceModel(model)) {
    if (isSystemProviderId(provider.id)) {
      switch (provider.id) {
        case SystemProviderIds.dashscope:
          return {
            enable_thinking: true,
            incremental_output: true
          }
        // TODO: 支持 new-api类型
        case SystemProviderIds['new-api']:
        case SystemProviderIds.cherryin: {
          return {
            extra_body: {
              thinking: {
                type: 'enabled' // auto is invalid
              }
            }
          }
        }
        case SystemProviderIds.hunyuan:
        case SystemProviderIds['tencent-cloud-ti']:
        case SystemProviderIds.doubao:
        case SystemProviderIds.deepseek:
        case SystemProviderIds.aihubmix:
        case SystemProviderIds.sophnet:
        case SystemProviderIds.ppio:
        case SystemProviderIds.dmxapi:
          return {
            thinking: {
              type: 'enabled' // auto is invalid
            }
          }
        case SystemProviderIds.openrouter:
        case SystemProviderIds.together:
          return {
            reasoning: {
              enabled: true
            }
          }
        default:
          break
      }
    }
    logger.warn(
      `Use default thinking options for provider ${provider.name} as DeepSeek v3.1+ thinking control method is unknown`
    )
    return {
      thinking: {
        type: 'enabled'
      }
    }
  }

  // OpenRouter models, use reasoning
  // FIXME: duplicated openrouter handling. remove one
  if (model.providerId === SystemProviderIds.openrouter) {
    if (isSupportedReasoningEffortModel(model) || isSupportedThinkingTokenModel(model)) {
      return {
        reasoning: {
          effort: reasoningEffort === 'auto' ? 'medium' : reasoningEffort
        }
      }
    }
  }

  // https://help.aliyun.com/zh/model-studio/deep-thinking
  if (provider.id === SystemProviderIds.dashscope) {
    // For dashscope: Qwen, DeepSeek, and GLM models use enable_thinking to control thinking
    // No effort, only on/off
    if (
      isQwenReasoningModel(model) ||
      isSupportedThinkingTokenZhipuModel(model) ||
      isSupportedThinkingTokenKimiModel(model)
    ) {
      return {
        enable_thinking: true,
        thinking_budget: budgetTokens
      }
    }
  }

  // https://docs.together.ai/reference/chat-completions-1#body-reasoning-effort
  if (provider.id === SystemProviderIds.together) {
    let adjustedReasoningEffort: 'low' | 'medium' | 'high' = 'medium'
    switch (reasoningEffort) {
      case 'minimal':
        adjustedReasoningEffort = 'low'
        break
      case 'xhigh':
      case 'max':
        adjustedReasoningEffort = 'high'
        break
      case 'auto':
        adjustedReasoningEffort = 'medium'
        break
      default:
        adjustedReasoningEffort = reasoningEffort
        break
    }
    return {
      // Only low, medium, high
      reasoningEffort: adjustedReasoningEffort,
      reasoning: { enabled: true }
    }
  }

  // Qwen models, use enable_thinking
  if (isQwenReasoningModel(model)) {
    const supportEnableThinking = isSupportEnableThinkingProvider(provider)
    const enableThinkingConfig = isQwenAlwaysThinkModel(model) ? {} : { enable_thinking: true }
    if (supportEnableThinking) {
      return {
        ...enableThinkingConfig,
        thinking_budget: budgetTokens
      }
    } else {
      return {
        chat_template_kwargs: {
          ...enableThinkingConfig,
          thinking_budget: budgetTokens
        }
      }
    }
  }

  // Hunyuan models, use enable_thinking
  if (isSupportedThinkingTokenHunyuanModel(model) && isSupportEnableThinkingProvider(provider)) {
    return {
      enable_thinking: true
    }
  }

  // Grok models/Perplexity models/OpenAI models, use reasoning_effort
  if (isSupportedReasoningEffortModel(model)) {
    // 检查模型是否支持所选选项
    const supportedOptions = getModelSupportedReasoningEffortOptions(model)?.filter((option) => option !== 'default')
    if (supportedOptions?.includes(reasoningEffort)) {
      return {
        reasoningEffort
      }
    } else {
      // 如果不支持，fallback到第一个支持的值
      return {
        reasoningEffort: supportedOptions?.[0] as ReasoningEffortOption | undefined
      }
    }
  }

  // Mistral Small models use reasoningEffort with 'none' | 'high'
  if (modelId.includes('mistral-small-2603')) {
    return { reasoningEffort: 'high' }
  }

  // gemini series, openai compatible api
  if (isSupportedThinkingTokenGeminiModel(model)) {
    // https://ai.google.dev/gemini-api/docs/gemini-3?thinking=high#openai_compatibility
    if (isGemini3ThinkingTokenModel(model)) {
      return {
        reasoningEffort
      }
    }
    if (reasoningEffort === 'auto') {
      return {
        extra_body: {
          google: {
            thinking_config: {
              thinking_budget: -1,
              include_thoughts: true
            }
          }
        }
      }
    }
    return {
      extra_body: {
        google: {
          thinking_config: {
            thinking_budget: budgetTokens ?? -1,
            include_thoughts: true
          }
        }
      }
    }
  }

  // Claude models, openai compatible api
  if (isSupportedThinkingTokenClaudeModel(model)) {
    const maxTokens = assistant.settings?.maxTokens
    return {
      thinking: {
        type: 'enabled',
        budget_tokens: budgetTokens
          ? Math.floor(Math.max(1024, Math.min(budgetTokens, (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio)))
          : undefined
      }
    }
  }

  // Use thinking, doubao, zhipu, etc.
  if (isSupportedThinkingTokenDoubaoModel(model)) {
    if (isDoubaoSeedAfter251015(model) || isDoubaoSeed18Model(model)) {
      return { reasoningEffort }
    }
    if (reasoningEffort === 'high') {
      return { thinking: { type: 'enabled' } }
    }
    if (reasoningEffort === 'auto' && isDoubaoThinkingAutoModel(model)) {
      return { thinking: { type: 'auto' } }
    }
    // 其他情况不带 thinking 字段
    return {}
  }
  if (isSupportedThinkingTokenZhipuModel(model)) {
    if (provider.id === SystemProviderIds.cerebras) {
      return {}
    }
    return { thinking: { type: 'enabled' } }
  }

  if (isSupportedThinkingTokenMiMoModel(model) || isSupportedThinkingTokenKimiModel(model)) {
    return {
      thinking: { type: 'enabled' }
    }
  }

  // Default case: no special thinking settings
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

  if (!reasoningEffort || reasoningEffort === 'default') {
    // default IS auto: adaptive-generation Claude gets the explicit
    // "model decides" envelope (Opus 4.7/4.8 default to OFF without it);
    // everywhere else, sending nothing is the auto behavior.
    return isAdaptiveClaude ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}
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
  //
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
