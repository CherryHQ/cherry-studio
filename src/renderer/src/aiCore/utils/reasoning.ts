import { loggerService } from '@logger'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
  findTokenLimit,
  GEMINI_FLASH_MODEL_REGEX,
  getThinkModelType,
  isDeepSeekHybridInferenceModel,
  isDoubaoSeedAfter251015,
  isDoubaoThinkingAutoModel,
  isGrok4FastReasoningModel,
  isGrokReasoningModel,
  isOpenAIDeepResearchModel,
  isOpenAIModel,
  isOpenAIReasoningModel,
  isQwenAlwaysThinkModel,
  isQwenReasoningModel,
  isReasoningModel,
  isSupportedReasoningEffortGrokModel,
  isSupportedReasoningEffortModel,
  isSupportedReasoningEffortOpenAIModel,
  isSupportedThinkingTokenClaudeModel,
  isSupportedThinkingTokenDoubaoModel,
  isSupportedThinkingTokenGeminiModel,
  isSupportedThinkingTokenHunyuanModel,
  isSupportedThinkingTokenModel,
  isSupportedThinkingTokenQwenModel,
  isSupportedThinkingTokenZhipuModel,
  MODEL_SUPPORTED_REASONING_EFFORT
} from '@renderer/config/models'
import { isSupportEnableThinkingProvider } from '@renderer/config/providers'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import { getAssistantSettings, getProviderByModel } from '@renderer/services/AssistantService'
import type { SettingsState } from '@renderer/store/settings'
import type { Assistant, Model } from '@renderer/types'
import { EFFORT_RATIO, isSystemProvider, SystemProviderIds } from '@renderer/types'
import type { ReasoningEffortOptionalParams } from '@renderer/types/sdk'
import { toInteger } from 'lodash'

const logger = loggerService.withContext('reasoning')

// The function is only for generic provider. May extract some logics to independent provider
export function getReasoningEffort(assistant: Assistant, model: Model): ReasoningEffortOptionalParams {
  const provider = getProviderByModel(model)
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
  const reasoningEffort = assistant?.settings?.reasoning_effort

  if (!reasoningEffort) {
    // openrouter: use reasoning
    if (model.provider === SystemProviderIds.openrouter) {
      // Don't disable reasoning for Gemini models that support thinking tokens
      if (isSupportedThinkingTokenGeminiModel(model) && !GEMINI_FLASH_MODEL_REGEX.test(model.id)) {
        return {}
      }
      // Don't disable reasoning for models that require it
      if (
        isGrokReasoningModel(model) ||
        isOpenAIReasoningModel(model) ||
        isQwenAlwaysThinkModel(model) ||
        model.id.includes('seed-oss') ||
        model.id.includes('minimax-m2')
      ) {
        return {}
      }
      return { reasoning: { enabled: false, exclude: true } }
    }

    // providers that use enable_thinking
    if (
      isSupportEnableThinkingProvider(provider) &&
      (isSupportedThinkingTokenQwenModel(model) ||
        isSupportedThinkingTokenHunyuanModel(model) ||
        (provider.id === SystemProviderIds.dashscope && isDeepSeekHybridInferenceModel(model)))
    ) {
      return { enable_thinking: false }
    }

    // claude
    if (isSupportedThinkingTokenClaudeModel(model)) {
      return {}
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
      }
      return {}
    }

    // use thinking, doubao, zhipu, etc.
    if (isSupportedThinkingTokenDoubaoModel(model) || isSupportedThinkingTokenZhipuModel(model)) {
      return { thinking: { type: 'disabled' } }
    }

    return {}
  }

  // reasoningEffort有效的情况

  // OpenRouter models
  if (model.provider === SystemProviderIds.openrouter) {
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
  const tokenLimit = findTokenLimit(model.id)
  let budgetTokens: number | undefined
  if (tokenLimit) {
    budgetTokens = Math.floor((tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min)
  }

  // See https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions
  if (model.provider === SystemProviderIds.silicon) {
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

  // DeepSeek hybrid inference models, v3.1 and maybe more in the future
  // 不同的 provider 有不同的思考控制方式，在这里统一解决
  if (isDeepSeekHybridInferenceModel(model)) {
    if (isSystemProvider(provider)) {
      switch (provider.id) {
        case SystemProviderIds.dashscope:
          return {
            enable_thinking: true,
            incremental_output: true
          }
        case SystemProviderIds.hunyuan:
        case SystemProviderIds['tencent-cloud-ti']:
        case SystemProviderIds.doubao:
          return {
            thinking: {
              type: 'enabled' // auto is invalid
            }
          }
        case SystemProviderIds.openrouter:
          return {
            reasoning: {
              enabled: true
            }
          }
        case 'nvidia':
          return {
            chat_template_kwargs: {
              thinking: true
            }
          }
        default:
          logger.warn(
            `Skipping thinking options for provider ${provider.name} as DeepSeek v3.1 thinking control method is unknown`
          )
        case SystemProviderIds.silicon:
        // specially handled before
      }
    }
  }

  // OpenRouter models, use reasoning
  if (model.provider === SystemProviderIds.openrouter) {
    if (isSupportedReasoningEffortModel(model) || isSupportedThinkingTokenModel(model)) {
      return {
        reasoning: {
          effort: reasoningEffort === 'auto' ? 'medium' : reasoningEffort
        }
      }
    }
  }

  // Qwen models, use enable_thinking
  if (isQwenReasoningModel(model)) {
    const thinkConfig = {
      enable_thinking: isQwenAlwaysThinkModel(model) || !isSupportEnableThinkingProvider(provider) ? undefined : true,
      thinking_budget: budgetTokens
    }
    if (provider.id === SystemProviderIds.dashscope) {
      return {
        ...thinkConfig,
        incremental_output: true
      }
    }
    return thinkConfig
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
    const modelType = getThinkModelType(model)
    const supportedOptions = MODEL_SUPPORTED_REASONING_EFFORT[modelType]
    if (supportedOptions.includes(reasoningEffort)) {
      return {
        reasoningEffort
      }
    } else {
      // 如果不支持，fallback到第一个支持的值
      return {
        reasoningEffort: supportedOptions[0]
      }
    }
  }

  // gemini series, openai compatible api
  if (isSupportedThinkingTokenGeminiModel(model)) {
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
    if (isDoubaoSeedAfter251015(model)) {
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
    return { thinking: { type: 'enabled' } }
  }

  // Default case: no special thinking settings
  return {}
}

/**
 * 获取 OpenAI 推理参数
 * 从 OpenAIResponseAPIClient 和 OpenAIAPIClient 中提取的逻辑
 */
export function getOpenAIReasoningParams(assistant: Assistant, model: Model): Record<string, any> {
  if (!isReasoningModel(model)) {
    return {}
  }

  let reasoningEffort = assistant?.settings?.reasoning_effort

  if (!reasoningEffort) {
    return {}
  }

  // 非OpenAI模型，但是Provider类型是responses/azure openai的情况
  if (!isOpenAIModel(model)) {
    return {
      reasoningEffort
    }
  }

  const openAI = getStoreSetting('openAI') as SettingsState['openAI']
  const summaryText = openAI?.summaryText || 'off'

  let reasoningSummary: string | undefined = undefined

  if (summaryText === 'off' || model.id.includes('o1-pro')) {
    reasoningSummary = undefined
  } else {
    reasoningSummary = summaryText
  }

  if (isOpenAIDeepResearchModel(model)) {
    reasoningEffort = 'medium'
  }

  // OpenAI 推理参数
  if (isSupportedReasoningEffortOpenAIModel(model)) {
    return {
      reasoningEffort,
      reasoningSummary
    }
  }

  return {}
}

export function getAnthropicThinkingBudget(assistant: Assistant, model: Model): number {
  const { maxTokens, reasoning_effort: reasoningEffort } = getAssistantSettings(assistant)
  if (reasoningEffort === undefined) {
    return 0
  }
  const effortRatio = EFFORT_RATIO[reasoningEffort]

  const budgetTokens = Math.max(
    1024,
    Math.floor(
      Math.min(
        (findTokenLimit(model.id)?.max! - findTokenLimit(model.id)?.min!) * effortRatio +
          findTokenLimit(model.id)?.min!,
        (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio
      )
    )
  )
  return budgetTokens
}

/**
 * 获取 Anthropic 推理参数
 * 从 AnthropicAPIClient 中提取的逻辑
 */
export function getAnthropicReasoningParams(assistant: Assistant, model: Model): Record<string, any> {
  if (!isReasoningModel(model)) {
    return {}
  }

  const reasoningEffort = assistant?.settings?.reasoning_effort

  if (reasoningEffort === undefined) {
    return {
      thinking: {
        type: 'disabled'
      }
    }
  }

  // Claude 推理参数
  if (isSupportedThinkingTokenClaudeModel(model)) {
    const budgetTokens = getAnthropicThinkingBudget(assistant, model)

    return {
      thinking: {
        type: 'enabled',
        budgetTokens: budgetTokens
      }
    }
  }

  return {}
}

/**
 * 获取 Gemini 推理参数
 * 从 GeminiAPIClient 中提取的逻辑
 */
export function getGeminiReasoningParams(assistant: Assistant, model: Model): Record<string, any> {
  if (!isReasoningModel(model)) {
    return {}
  }

  const reasoningEffort = assistant?.settings?.reasoning_effort

  // Gemini 推理参数
  if (isSupportedThinkingTokenGeminiModel(model)) {
    if (reasoningEffort === undefined) {
      return {
        thinkingConfig: {
          include_thoughts: false,
          ...(GEMINI_FLASH_MODEL_REGEX.test(model.id) ? { thinking_budget: 0 } : {})
        }
      }
    }

    const effortRatio = EFFORT_RATIO[reasoningEffort]

    if (effortRatio > 1) {
      return {
        thinkingConfig: {
          include_thoughts: true
        }
      }
    }

    const { min, max } = findTokenLimit(model.id) || { min: 0, max: 0 }
    const budget = Math.floor((max - min) * effortRatio + min)

    return {
      thinkingConfig: {
        ...(budget > 0 ? { thinking_budget: budget } : {}),
        include_thoughts: true
      }
    }
  }

  return {}
}

/**
 * Get XAI-specific reasoning parameters
 * This function should only be called for XAI provider models
 * @param assistant - The assistant configuration
 * @param model - The model being used
 * @returns XAI-specific reasoning parameters
 */
export function getXAIReasoningParams(assistant: Assistant, model: Model): Record<string, any> {
  if (!isSupportedReasoningEffortGrokModel(model)) {
    return {}
  }

  const { reasoning_effort: reasoningEffort } = getAssistantSettings(assistant)

  if (!reasoningEffort) {
    return {}
  }

  // For XAI provider Grok models, use reasoningEffort parameter directly
  return {
    reasoningEffort
  }
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
