import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
  findTokenLimit,
  GEMINI_FLASH_MODEL_REGEX,
  isDoubaoThinkingAutoModel,
  isReasoningModel,
  isSupportedReasoningEffortGrokModel,
  isSupportedReasoningEffortModel,
  isSupportedReasoningEffortOpenAIModel,
  isSupportedThinkingTokenClaudeModel,
  isSupportedThinkingTokenDoubaoModel,
  isSupportedThinkingTokenGeminiModel,
  isSupportedThinkingTokenModel,
  isSupportedThinkingTokenQwenModel
} from '@renderer/config/models'
import { getAssistantSettings, getProviderByModel } from '@renderer/services/AssistantService'
import { Assistant, EFFORT_RATIO, Model } from '@renderer/types'
import { ReasoningEffortOptionalParams } from '@renderer/types/sdk'

import { getAiSdkProviderId } from '../provider/factory'

export function getReasoningEffort(assistant: Assistant, model: Model): ReasoningEffortOptionalParams {
  const provider = getProviderByModel(model)
  if (provider.id === 'groq') {
    return {}
  }

  if (!isReasoningModel(model)) {
    return {}
  }
  const reasoningEffort = assistant?.settings?.reasoning_effort

  // Doubao 思考模式支持
  if (isSupportedThinkingTokenDoubaoModel(model)) {
    // reasoningEffort 为空，默认开启 enabled
    if (!reasoningEffort) {
      return { thinking: { type: 'disabled' } }
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

  if (!reasoningEffort) {
    if (isSupportedThinkingTokenQwenModel(model)) {
      return { enable_thinking: false }
    }

    if (isSupportedThinkingTokenClaudeModel(model)) {
      return {}
    }

    if (isSupportedThinkingTokenGeminiModel(model)) {
      // openrouter没有提供一个不推理的选项，先隐藏
      if (provider.id === 'openrouter') {
        return { reasoning: { max_tokens: 0, exclude: true } }
      }
      if (GEMINI_FLASH_MODEL_REGEX.test(model.id)) {
        return { reasoning_effort: 'none' }
      }
      return {}
    }

    if (isSupportedThinkingTokenDoubaoModel(model)) {
      return { thinking: { type: 'disabled' } }
    }

    return {}
  }
  const effortRatio = EFFORT_RATIO[reasoningEffort]
  const budgetTokens = Math.floor(
    (findTokenLimit(model.id)?.max! - findTokenLimit(model.id)?.min!) * effortRatio + findTokenLimit(model.id)?.min!
  )

  // OpenRouter models
  if (model.provider === 'openrouter') {
    if (isSupportedReasoningEffortModel(model) || isSupportedThinkingTokenModel(model)) {
      return {
        reasoning: {
          effort: reasoningEffort === 'auto' ? 'medium' : reasoningEffort
        }
      }
    }
  }

  // Qwen models
  if (isSupportedThinkingTokenQwenModel(model)) {
    return {
      enable_thinking: true,
      thinking_budget: budgetTokens
    }
  }

  // Grok models
  if (isSupportedReasoningEffortGrokModel(model)) {
    return {
      reasoning_effort: reasoningEffort
    }
  }

  // OpenAI models
  if (isSupportedReasoningEffortOpenAIModel(model) || isSupportedThinkingTokenGeminiModel(model)) {
    return {
      reasoning_effort: reasoningEffort
    }
  }

  // Claude models
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

  // Doubao models
  if (isSupportedThinkingTokenDoubaoModel(model)) {
    if (assistant.settings?.reasoning_effort === 'high') {
      return {
        thinking: {
          type: 'enabled'
        }
      }
    }
  }

  // Default case: no special thinking settings
  return {}
}

/**
 * 构建 AI SDK 的 providerOptions
 * 按 provider 类型分离，保持类型安全
 * 返回格式：{ 'providerId': providerOptions }
 */
export function buildProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  }
): Record<string, any> {
  const provider = getProviderByModel(model)
  const providerId = getAiSdkProviderId(provider)

  // 构建 provider 特定的选项
  let providerSpecificOptions: Record<string, any> = {}

  // 根据 provider 类型分离构建逻辑
  switch (provider.type) {
    case 'openai':
    case 'azure-openai':
      providerSpecificOptions = buildOpenAIProviderOptions(assistant, model, capabilities)
      break

    case 'anthropic':
      providerSpecificOptions = buildAnthropicProviderOptions(assistant, model, capabilities)
      break

    case 'gemini':
    case 'vertexai':
      providerSpecificOptions = buildGeminiProviderOptions(assistant, model, capabilities)
      break

    default:
      // 对于其他 provider，使用通用的构建逻辑
      providerSpecificOptions = buildGenericProviderOptions(assistant, model, capabilities)
      break
  }

  // 合并自定义参数到 provider 特定的选项中
  const customParameters = getCustomParameters(assistant)
  Object.assign(providerSpecificOptions, customParameters)

  // 返回 AI Core SDK 要求的格式：{ 'providerId': providerOptions }
  return {
    [providerId]: providerSpecificOptions
  }
}

/**
 * 构建 OpenAI 特定的 providerOptions
 */
function buildOpenAIProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  }
): Record<string, any> {
  const { enableReasoning, enableWebSearch, enableGenerateImage } = capabilities
  const providerOptions: Record<string, any> = {}

  // OpenAI 推理参数
  if (enableReasoning) {
    const reasoningParams = getOpenAIReasoningParams(assistant, model)
    Object.assign(providerOptions, reasoningParams)
  }

  // Web 搜索和图像生成暂时使用通用格式
  if (enableWebSearch) {
    providerOptions.webSearch = { enabled: true }
  }

  if (enableGenerateImage) {
    providerOptions.generateImage = { enabled: true }
  }

  return providerOptions
}

/**
 * 构建 Anthropic 特定的 providerOptions
 */
function buildAnthropicProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  }
): Record<string, any> {
  const { enableReasoning, enableWebSearch, enableGenerateImage } = capabilities
  const providerOptions: Record<string, any> = {}

  // Anthropic 推理参数
  if (enableReasoning) {
    const reasoningParams = getAnthropicReasoningParams(assistant, model)
    Object.assign(providerOptions, reasoningParams)
  }

  if (enableWebSearch) {
    providerOptions.webSearch = { enabled: true }
  }

  if (enableGenerateImage) {
    providerOptions.generateImage = { enabled: true }
  }

  return providerOptions
}

/**
 * 构建 Gemini 特定的 providerOptions
 */
function buildGeminiProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  }
): Record<string, any> {
  const { enableReasoning, enableWebSearch, enableGenerateImage } = capabilities
  const providerOptions: Record<string, any> = {}

  // Gemini 推理参数
  if (enableReasoning) {
    const reasoningParams = getGeminiReasoningParams(assistant, model)
    Object.assign(providerOptions, reasoningParams)
  }

  if (enableWebSearch) {
    providerOptions.webSearch = { enabled: true }
  }

  if (enableGenerateImage) {
    providerOptions.generateImage = { enabled: true }
  }

  return providerOptions
}

/**
 * 构建通用的 providerOptions（用于其他 provider）
 */
function buildGenericProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  }
): Record<string, any> {
  const { enableReasoning, enableWebSearch, enableGenerateImage } = capabilities
  const providerOptions: Record<string, any> = {}

  // 使用原有的通用推理逻辑
  if (enableReasoning) {
    const reasoningParams = getReasoningEffort(assistant, model)
    Object.assign(providerOptions, reasoningParams)
  }

  if (enableWebSearch) {
    providerOptions.webSearch = { enabled: true }
  }

  if (enableGenerateImage) {
    providerOptions.generateImage = { enabled: true }
  }

  return providerOptions
}

/**
 * 获取 OpenAI 推理参数
 * 从 OpenAIResponseAPIClient 和 OpenAIAPIClient 中提取的逻辑
 */
function getOpenAIReasoningParams(assistant: Assistant, model: Model): Record<string, any> {
  if (!isReasoningModel(model)) {
    return {}
  }

  const reasoningEffort = assistant?.settings?.reasoning_effort

  if (!reasoningEffort) {
    return {}
  }

  // OpenAI 推理参数
  if (isSupportedReasoningEffortOpenAIModel(model)) {
    return {
      reasoning_effort: reasoningEffort
    }
  }

  return {}
}

/**
 * 获取 Anthropic 推理参数
 * 从 AnthropicAPIClient 中提取的逻辑
 */
function getAnthropicReasoningParams(assistant: Assistant, model: Model): Record<string, any> {
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
    const { maxTokens } = getAssistantSettings(assistant)
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
function getGeminiReasoningParams(assistant: Assistant, model: Model): Record<string, any> {
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

/**
 * 获取自定义参数
 * 从 assistant 设置中提取自定义参数
 */
function getCustomParameters(assistant: Assistant): Record<string, any> {
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
