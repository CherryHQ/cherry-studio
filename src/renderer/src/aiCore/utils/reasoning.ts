import type { BedrockProviderOptions } from '@ai-sdk/amazon-bedrock'
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { XaiProviderOptions } from '@ai-sdk/xai'
import { loggerService } from '@logger'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
  findTokenLimit,
  GEMINI_FLASH_MODEL_REGEX,
  getThinkModelType,
  isDeepSeekHybridInferenceModel,
  isDoubaoSeedAfter251015,
  isDoubaoThinkingAutoModel,
  isGemini3ThinkingTokenModel,
  isGPT5SeriesModel,
  isGPT51SeriesModel,
  isGrok4FastReasoningModel,
  isOpenAIDeepResearchModel,
  isOpenAIModel,
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
import { getStoreSetting } from '@renderer/hooks/useSettings'
import { getAssistantSettings, getProviderByModel } from '@renderer/services/AssistantService'
import type { Assistant, Model } from '@renderer/types'
import { EFFORT_RATIO, isSystemProvider, SystemProviderIds } from '@renderer/types'
import type { OpenAIReasoningSummary } from '@renderer/types/aiCoreTypes'
import type { ReasoningEffortOptionalParams } from '@renderer/types/sdk'
import { isSupportEnableThinkingProvider } from '@renderer/utils/provider'
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

  // reasoningEffort is not set, no extra reasoning setting
  // Generally, for every model which supports reasoning control, the reasoning effort won't be undefined.
  // It's for some reasoning models that don't support reasoning control, such as deepseek reasoner.
  if (!reasoningEffort) {
    return {}
  }

  // Handle 'none' reasoningEffort. It's explicitly off.
  if (reasoningEffort === 'none') {
    // openrouter: use reasoning
    if (model.provider === SystemProviderIds.openrouter) {
      // 'none' is not an available value for effort for now.
      // I think they should resolve this issue soon, so I'll just go ahead and use this value.
      if (isGPT51SeriesModel(model) && reasoningEffort === 'none') {
        return { reasoning: { effort: 'none' } }
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
    if (isSupportedThinkingTokenDoubaoModel(model) || isSupportedThinkingTokenZhipuModel(model)) {
      if (provider.id === SystemProviderIds.cerebras) {
        return {
          disable_reasoning: true
        }
      }
      return { thinking: { type: 'disabled' } }
    }

    // Specially for GPT-5.1. Suppose this is a OpenAI Compatible provider
    if (isGPT51SeriesModel(model)) {
      return {
        reasoningEffort: 'none'
      }
    }

    logger.warn(`Model ${model.id} doesn't match any disable reasoning behavior. Fallback to empty reasoning param.`)
    return {}
  }

  // reasoningEffort有效的情况
  // https://creator.poe.com/docs/external-applications/openai-compatible-api#additional-considerations
  // Poe provider - supports custom bot parameters via extra_body
  if (provider.id === SystemProviderIds.poe) {
    // GPT-5 series models use reasoning_effort parameter in extra_body
    if (isGPT5SeriesModel(model) || isGPT51SeriesModel(model)) {
      return {
        extra_body: {
          reasoning_effort: reasoningEffort === 'auto' ? 'medium' : reasoningEffort
        }
      }
    }

    // Claude models use thinking_budget parameter in extra_body
    if (isSupportedThinkingTokenClaudeModel(model)) {
      const effortRatio = EFFORT_RATIO[reasoningEffort]
      const tokenLimit = findTokenLimit(model.id)
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
      const tokenLimit = findTokenLimit(model.id)
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

  // OpenRouter models, use reasoning
  // FIXME: duplicated openrouter handling. remove one
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
    // https://ai.google.dev/gemini-api/docs/gemini-3?thinking=high#openai_compatibility
    if (isGemini3ThinkingTokenModel(model)) {
      return {
        reasoning_effort: reasoningEffort
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
    if (provider.id === SystemProviderIds.cerebras) {
      return {}
    }
    return { thinking: { type: 'enabled' } }
  }

  // Default case: no special thinking settings
  return {}
}

/**
 * Get OpenAI reasoning parameters
 * Extracted from OpenAIResponseAPIClient and OpenAIAPIClient logic
 * For official OpenAI provider only
 */
export function getOpenAIReasoningParams(
  assistant: Assistant,
  model: Model
): Pick<OpenAIResponsesProviderOptions, 'reasoningEffort' | 'reasoningSummary'> {
  if (!isReasoningModel(model)) {
    return {}
  }

  let reasoningEffort = assistant?.settings?.reasoning_effort

  if (!reasoningEffort) {
    return {}
  }

  if (isOpenAIDeepResearchModel(model) || reasoningEffort === 'auto') {
    reasoningEffort = 'medium'
  }

  // 非OpenAI模型，但是Provider类型是responses/azure openai的情况
  if (!isOpenAIModel(model)) {
    return {
      reasoningEffort
    }
  }

  const openAI = getStoreSetting('openAI')
  const summaryText = openAI.summaryText

  let reasoningSummary: OpenAIReasoningSummary = undefined

  if (model.id.includes('o1-pro')) {
    reasoningSummary = undefined
  } else {
    reasoningSummary = summaryText
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

export function getAnthropicThinkingBudget(
  maxTokens: number | undefined,
  reasoningEffort: string | undefined,
  modelId: string
): number | undefined {
  if (reasoningEffort === undefined || reasoningEffort === 'none') {
    return undefined
  }
  const effortRatio = EFFORT_RATIO[reasoningEffort]

  const tokenLimit = findTokenLimit(modelId)
  if (!tokenLimit) {
    return undefined
  }

  const budgetTokens = Math.max(
    1024,
    Math.floor(
      Math.min(
        (tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min,
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
export function getAnthropicReasoningParams(
  assistant: Assistant,
  model: Model
): Pick<AnthropicProviderOptions, 'thinking'> {
  if (!isReasoningModel(model)) {
    return {}
  }

  const reasoningEffort = assistant?.settings?.reasoning_effort

  if (reasoningEffort === undefined || reasoningEffort === 'none') {
    return {
      thinking: {
        type: 'disabled'
      }
    }
  }

  // Claude 推理参数
  if (isSupportedThinkingTokenClaudeModel(model)) {
    const { maxTokens } = getAssistantSettings(assistant)
    const budgetTokens = getAnthropicThinkingBudget(maxTokens, reasoningEffort, model.id)

    return {
      thinking: {
        type: 'enabled',
        budgetTokens: budgetTokens
      }
    }
  }

  return {}
}

// type GoogleThinkingLevel = NonNullable<GoogleGenerativeAIProviderOptions['thinkingConfig']>['thinkingLevel']

// function mapToGeminiThinkingLevel(reasoningEffort: ReasoningEffortOption): GoogelThinkingLevel {
//   switch (reasoningEffort) {
//     case 'low':
//       return 'low'
//     case 'medium':
//       return 'medium'
//     case 'high':
//       return 'high'
//     default:
//       return 'medium'
//   }
// }

/**
 * 获取 Gemini 推理参数
 * 从 GeminiAPIClient 中提取的逻辑
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

  const reasoningEffort = assistant?.settings?.reasoning_effort

  // Gemini 推理参数
  if (isSupportedThinkingTokenGeminiModel(model)) {
    if (reasoningEffort === undefined || reasoningEffort === 'none') {
      return {
        thinkingConfig: {
          includeThoughts: false,
          ...(GEMINI_FLASH_MODEL_REGEX.test(model.id) ? { thinkingBudget: 0 } : {})
        }
      }
    }

    // TODO: 很多中转还不支持
    // https://ai.google.dev/gemini-api/docs/gemini-3?thinking=high#new_api_features_in_gemini_3
    // if (isGemini3ThinkingTokenModel(model)) {
    //   return {
    //     thinkingConfig: {
    //       thinkingLevel: mapToGeminiThinkingLevel(reasoningEffort)
    //     }
    //   }
    // }

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

/**
 * Get XAI-specific reasoning parameters
 * This function should only be called for XAI provider models
 * @param assistant - The assistant configuration
 * @param model - The model being used
 * @returns XAI-specific reasoning parameters
 */
export function getXAIReasoningParams(assistant: Assistant, model: Model): Pick<XaiProviderOptions, 'reasoningEffort'> {
  if (!isSupportedReasoningEffortGrokModel(model)) {
    return {}
  }

  const { reasoning_effort: reasoningEffort } = getAssistantSettings(assistant)

  if (!reasoningEffort || reasoningEffort === 'none') {
    return {}
  }

  switch (reasoningEffort) {
    case 'auto':
    case 'minimal':
    case 'medium':
      return { reasoningEffort: 'low' }
    case 'low':
    case 'high':
      return { reasoningEffort }
  }
}

/**
 * Get Bedrock reasoning parameters
 */
export function getBedrockReasoningParams(
  assistant: Assistant,
  model: Model
): Pick<BedrockProviderOptions, 'reasoningConfig'> {
  if (!isReasoningModel(model)) {
    return {}
  }

  const reasoningEffort = assistant?.settings?.reasoning_effort

  if (reasoningEffort === undefined) {
    return {}
  }

  if (reasoningEffort === 'none') {
    return {
      reasoningConfig: {
        type: 'disabled'
      }
    }
  }

  // Only apply thinking budget for Claude reasoning models
  if (!isSupportedThinkingTokenClaudeModel(model)) {
    return {}
  }

  const { maxTokens } = getAssistantSettings(assistant)
  const budgetTokens = getAnthropicThinkingBudget(maxTokens, reasoningEffort, model.id)
  return {
    reasoningConfig: {
      type: 'enabled',
      budgetTokens: budgetTokens
    }
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
      // Parse JSON type parameters
      // Related: src/renderer/src/pages/settings/AssistantSettings/AssistantModelSettings.tsx:133-148
      // The UI stores JSON type params as strings (e.g., '{"key":"value"}')
      // This function parses them into objects before sending to the API
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
      // Ensure number type parameters are always numbers (not strings)
      if (param.type === 'number') {
        return {
          ...acc,
          [param.name]: Number(param.value)
        }
      }
      return {
        ...acc,
        [param.name]: param.value
      }
    }, {}) || {}
  )
}
