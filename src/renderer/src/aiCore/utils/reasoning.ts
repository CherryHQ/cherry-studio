import { loggerService } from '@logger'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
  findTokenLimit,
  GEMINI_FLASH_MODEL_REGEX,
  getThinkModelType,
  isDeepSeekHybridInferenceModel,
  isDoubaoThinkingAutoModel,
  isGrokReasoningModel,
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
import { SettingsState } from '@renderer/store/settings'
import { Assistant, EFFORT_RATIO, isSystemProvider, Model, SystemProviderIds } from '@renderer/types'
import { ReasoningEffortOptionalParams } from '@renderer/types/sdk'

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
  const reasoningEffort = assistant?.settings?.reasoning_effort

  if (!reasoningEffort) {
    // openrouter: use reasoning
    if (model.provider === SystemProviderIds.openrouter) {
      // Don't disable reasoning for Gemini models that support thinking tokens
      if (isSupportedThinkingTokenGeminiModel(model) && !GEMINI_FLASH_MODEL_REGEX.test(model.id)) {
        return {}
      }
      // Don't disable reasoning for models that require it
      if (isGrokReasoningModel(model) || isOpenAIReasoningModel(model)) {
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
        case SystemProviderIds.silicon:
          return {
            enable_thinking: true
          }
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
      }
    }
  }

  // OpenRouter models
  if (model.provider === SystemProviderIds.openrouter) {
    if (isSupportedReasoningEffortModel(model) || isSupportedThinkingTokenModel(model)) {
      return {
        reasoning: {
          effort: reasoningEffort === 'auto' ? 'medium' : reasoningEffort
        }
      }
    }
  }

  // Doubao 思考模式支持
  if (isSupportedThinkingTokenDoubaoModel(model)) {
    // reasoningEffort 为空，默认开启 enabled
    if (reasoningEffort === 'high') {
      return { thinking: { type: 'enabled' } }
    }
    if (reasoningEffort === 'auto' && isDoubaoThinkingAutoModel(model)) {
      return { thinking: { type: 'auto' } }
    }
    // 其他情况不带 thinking 字段
    return {}
  }

  const effortRatio = EFFORT_RATIO[reasoningEffort]
  const budgetTokens = Math.floor(
    (findTokenLimit(model.id)?.max! - findTokenLimit(model.id)?.min!) * effortRatio + findTokenLimit(model.id)?.min!
  )

  // OpenRouter models, use thinking
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
        reasoning_effort: reasoningEffort
      }
    } else {
      // 如果不支持，fallback到第一个支持的值
      return {
        reasoning_effort: supportedOptions[0]
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
            thinking_budget: budgetTokens,
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
        budget_tokens: Math.floor(
          Math.max(1024, Math.min(budgetTokens, (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio))
        )
      }
    }
  }

  // Use thinking, doubao, zhipu, etc.
  if (isSupportedThinkingTokenDoubaoModel(model)) {
    if (assistant.settings?.reasoning_effort === 'high') {
      return {
        thinking: {
          type: 'enabled'
        }
      }
    }
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
  const openAI = getStoreSetting('openAI') as SettingsState['openAI']
  const summaryText = openAI?.summaryText || 'off'

  let reasoningSummary: string | undefined = undefined

  if (summaryText === 'off' || model.id.includes('o1-pro')) {
    reasoningSummary = undefined
  } else {
    reasoningSummary = summaryText
  }

  const reasoningEffort = assistant?.settings?.reasoning_effort

  if (!reasoningEffort) {
    return {}
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
          includeThoughts: false,
          ...(GEMINI_FLASH_MODEL_REGEX.test(model.id) ? { thinkingBudget: 0 } : {})
        }
      }
    }

    const effortRatio = EFFORT_RATIO[reasoningEffort]

    if (effortRatio > 1) {
      return {
        thinkingConfig: {
          includeThoughts: true
        }
      }
    }

    const { min, max } = findTokenLimit(model.id) || { min: 0, max: 0 }
    const budget = Math.floor((max - min) * effortRatio + min)

    return {
      thinkingConfig: {
        ...(budget > 0 ? { thinkingBudget: budget } : {}),
        includeThoughts: true
      }
    }
  }

  return {}
}

export function getXAIReasoningParams(assistant: Assistant, model: Model): Record<string, any> {
  if (!isSupportedReasoningEffortGrokModel(model)) {
    return {}
  }

  const { reasoning_effort: reasoningEffort } = getAssistantSettings(assistant)

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
