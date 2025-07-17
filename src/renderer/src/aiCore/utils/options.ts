import { Assistant, Model, Provider } from '@renderer/types'

import { getAiSdkProviderId } from '../provider/factory'
import {
  getAnthropicReasoningParams,
  getCustomParameters,
  getGeminiReasoningParams,
  getOpenAIReasoningParams,
  getReasoningEffort,
  getXAIReasoningParams
} from './reasoning'
import { getWebSearchParams } from './websearch'

/**
 * 构建 AI SDK 的 providerOptions
 * 按 provider 类型分离，保持类型安全
 * 返回格式：{ 'providerId': providerOptions }
 */
export function buildProviderOptions(
  assistant: Assistant,
  model: Model,
  actualProvider: Provider,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  }
): Record<string, any> {
  const providerId = getAiSdkProviderId(actualProvider)

  // 构建 provider 特定的选项
  let providerSpecificOptions: Record<string, any> = {}

  // 根据 provider 类型分离构建逻辑
  switch (providerId) {
    case 'openai':
    case 'azure':
      providerSpecificOptions = {
        ...buildOpenAIProviderOptions(assistant, model, capabilities),
        // 函数内有对于真实provider.id的判断,应该不会影响原生provider
        ...buildGenericProviderOptions(assistant, model, capabilities)
      }

      break

    case 'anthropic':
      providerSpecificOptions = buildAnthropicProviderOptions(assistant, model, capabilities)
      break

    case 'google':
    case 'google-vertex':
      providerSpecificOptions = buildGeminiProviderOptions(assistant, model, capabilities)
      break

    case 'xai':
      providerSpecificOptions = buildXAIProviderOptions(assistant, model, capabilities)
      break

    default:
      // 对于其他 provider，使用通用的构建逻辑
      providerSpecificOptions = buildGenericProviderOptions(assistant, model, capabilities)
      break
  }

  // 合并自定义参数到 provider 特定的选项中
  providerSpecificOptions = {
    ...providerSpecificOptions,
    ...getCustomParameters(assistant)
  }

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
  const { enableReasoning } = capabilities
  let providerOptions: Record<string, any> = {}

  // OpenAI 推理参数
  if (enableReasoning) {
    const reasoningParams = getOpenAIReasoningParams(assistant, model)
    providerOptions = {
      ...providerOptions,
      ...reasoningParams
    }
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
  const { enableReasoning } = capabilities
  let providerOptions: Record<string, any> = {}

  // Anthropic 推理参数
  if (enableReasoning) {
    const reasoningParams = getAnthropicReasoningParams(assistant, model)
    providerOptions = {
      ...providerOptions,
      ...reasoningParams
    }
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
  const { enableReasoning } = capabilities
  let providerOptions: Record<string, any> = {}

  // Gemini 推理参数
  if (enableReasoning) {
    const reasoningParams = getGeminiReasoningParams(assistant, model)
    providerOptions = {
      ...providerOptions,
      ...reasoningParams
    }
  }

  return providerOptions
}

function buildXAIProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  }
): Record<string, any> {
  const { enableReasoning } = capabilities
  let providerOptions: Record<string, any> = {}

  if (enableReasoning) {
    const reasoningParams = getXAIReasoningParams(assistant, model)
    providerOptions = {
      ...providerOptions,
      ...reasoningParams
    }
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
  const { enableWebSearch } = capabilities
  let providerOptions: Record<string, any> = {}

  const reasoningParams = getReasoningEffort(assistant, model)
  providerOptions = {
    ...providerOptions,
    ...reasoningParams
  }

  if (enableWebSearch) {
    const webSearchParams = getWebSearchParams(model)
    providerOptions = {
      ...providerOptions,
      ...webSearchParams
    }
  }

  return providerOptions
}
