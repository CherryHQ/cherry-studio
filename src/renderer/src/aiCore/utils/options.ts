import type { BedrockProviderOptions } from '@ai-sdk/amazon-bedrock'
import { type AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { XaiProviderOptions } from '@ai-sdk/xai'
import { baseProviderIdSchema, customProviderIdSchema } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import {
  getModelSupportedVerbosity,
  isAnthropicModel,
  isGeminiModel,
  isGrokModel,
  isOpenAIModel,
  isQwenMTModel,
  isSupportFlexServiceTierModel,
  isSupportVerbosityModel
} from '@renderer/config/models'
import { mapLanguageToQwenMTModel } from '@renderer/config/translate'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import { getProviderById } from '@renderer/services/ProviderService'
import {
  type Assistant,
  type GroqServiceTier,
  GroqServiceTiers,
  type GroqSystemProvider,
  isGroqServiceTier,
  isGroqSystemProvider,
  isOpenAIServiceTier,
  isTranslateAssistant,
  type Model,
  type NotGroqProvider,
  type OpenAIServiceTier,
  OpenAIServiceTiers,
  type Provider,
  type ServiceTier,
  SystemProviderIds
} from '@renderer/types'
import { type AiSdkParam, isAiSdkParam, type OpenAIVerbosity } from '@renderer/types/aiCoreTypes'
import { isSupportServiceTierProvider, isSupportVerbosityProvider } from '@renderer/utils/provider'
import type { JSONValue } from 'ai'
import { t } from 'i18next'
import type { OllamaCompletionProviderOptions } from 'ollama-ai-provider-v2'

import { addAnthropicHeaders } from '../prepareParams/header'
import { getAiSdkProviderId } from '../provider/factory'
import { registeredNewProviderIdSchema } from '../provider/providerInitialization'
import { buildGeminiGenerateImageParams } from './image'
import {
  getAnthropicReasoningParams,
  getBedrockReasoningParams,
  getCustomParameters,
  getGeminiReasoningParams,
  getOpenAIReasoningParams,
  getReasoningEffort,
  getXAIReasoningParams
} from './reasoning'
import { getWebSearchParams } from './websearch'

const logger = loggerService.withContext('aiCore.utils.options')

function toOpenAIServiceTier(model: Model, serviceTier: ServiceTier): OpenAIServiceTier {
  if (
    !isOpenAIServiceTier(serviceTier) ||
    (serviceTier === OpenAIServiceTiers.flex && !isSupportFlexServiceTierModel(model))
  ) {
    return undefined
  } else {
    return serviceTier
  }
}

function toGroqServiceTier(model: Model, serviceTier: ServiceTier): GroqServiceTier {
  if (
    !isGroqServiceTier(serviceTier) ||
    (serviceTier === GroqServiceTiers.flex && !isSupportFlexServiceTierModel(model))
  ) {
    return undefined
  } else {
    return serviceTier
  }
}

function getServiceTier<T extends GroqSystemProvider>(model: Model, provider: T): GroqServiceTier
function getServiceTier<T extends NotGroqProvider>(model: Model, provider: T): OpenAIServiceTier
function getServiceTier<T extends Provider>(model: Model, provider: T): OpenAIServiceTier | GroqServiceTier {
  const serviceTierSetting = provider.serviceTier

  if (!isSupportServiceTierProvider(provider) || !isOpenAIModel(model) || !serviceTierSetting) {
    return undefined
  }

  // 处理不同供应商需要 fallback 到默认值的情况
  if (isGroqSystemProvider(provider)) {
    return toGroqServiceTier(model, serviceTierSetting)
  } else {
    // 其他 OpenAI 供应商，假设他们的服务层级设置和 OpenAI 完全相同
    return toOpenAIServiceTier(model, serviceTierSetting)
  }
}

function getVerbosity(model: Model): OpenAIVerbosity {
  if (!isSupportVerbosityModel(model) || !isSupportVerbosityProvider(getProviderById(model.provider)!)) {
    return undefined
  }
  const openAI = getStoreSetting('openAI')

  const userVerbosity = openAI.verbosity

  if (userVerbosity) {
    const supportedVerbosity = getModelSupportedVerbosity(model)
    // Use user's verbosity if supported, otherwise use the first supported option
    const verbosity = supportedVerbosity.includes(userVerbosity) ? userVerbosity : supportedVerbosity[0]
    return verbosity
  }
  return undefined
}

/**
 * Extract AI SDK standard parameters from custom parameters
 * These parameters should be passed directly to streamText() instead of providerOptions
 */
export function extractAiSdkStandardParams(customParams: Record<string, any>): {
  standardParams: Partial<Record<AiSdkParam, any>>
  providerParams: Record<string, any>
} {
  const standardParams: Partial<Record<AiSdkParam, any>> = {}
  const providerParams: Record<string, any> = {}

  for (const [key, value] of Object.entries(customParams)) {
    if (isAiSdkParam(key)) {
      standardParams[key] = value
    } else {
      providerParams[key] = value
    }
  }

  return { standardParams, providerParams }
}

/**
 * 构建 AI SDK 的 providerOptions
 * 按 provider 类型分离，保持类型安全
 * 返回格式：{
 *   providerOptions: { 'providerId': providerOptions },
 *   standardParams: { topK, frequencyPenalty, presencePenalty, stopSequences, seed }
 * }
 *
 * Custom parameters are split into two categories:
 * 1. AI SDK standard parameters (topK, frequencyPenalty, etc.) - returned separately to be passed to streamText()
 * 2. Provider-specific parameters - merged into providerOptions
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
): {
  providerOptions: Record<string, Record<string, JSONValue>>
  standardParams: Partial<Record<AiSdkParam, any>>
} {
  const rawProviderId = getAiSdkProviderId(actualProvider)
  logger.debug('buildProviderOptions', { assistant, model, actualProvider, capabilities, rawProviderId })
  // 构建 provider 特定的选项
  let providerSpecificOptions: Record<string, any> = {}
  const serviceTier = getServiceTier(model, actualProvider)
  const textVerbosity = getVerbosity(model)
  // 根据 provider 类型分离构建逻辑
  const { data: baseProviderId, success } = baseProviderIdSchema.safeParse(rawProviderId)
  if (success) {
    // 应该覆盖所有类型
    switch (baseProviderId) {
      case 'openai':
      case 'openai-chat':
      case 'azure':
      case 'azure-responses':
        {
          providerSpecificOptions = buildOpenAIProviderOptions(
            assistant,
            model,
            capabilities,
            serviceTier,
            textVerbosity
          )
        }
        break
      case 'anthropic':
        providerSpecificOptions = buildAnthropicProviderOptions(assistant, model, capabilities)
        break

      case 'google':
        providerSpecificOptions = buildGeminiProviderOptions(assistant, model, capabilities)
        break

      case 'xai':
        providerSpecificOptions = buildXAIProviderOptions(assistant, model, capabilities)
        break
      case 'deepseek':
      case 'openrouter':
      case 'openai-compatible': {
        // 对于其他 provider，使用通用的构建逻辑
        providerSpecificOptions = {
          [rawProviderId]: {
            ...buildGenericProviderOptions(assistant, model, capabilities),
            serviceTier,
            textVerbosity
          }
        }
        break
      }
      case 'cherryin':
        providerSpecificOptions = buildCherryInProviderOptions(
          assistant,
          model,
          capabilities,
          actualProvider,
          serviceTier,
          textVerbosity
        )
        break
      default:
        throw new Error(`Unsupported base provider ${baseProviderId}`)
    }
  } else {
    // 处理自定义 provider
    const { data: providerId, success, error } = customProviderIdSchema.safeParse(rawProviderId)
    if (success) {
      switch (providerId) {
        // 非 base provider 的单独处理逻辑
        case 'google-vertex':
          providerSpecificOptions = buildGeminiProviderOptions(assistant, model, capabilities)
          break
        case 'azure-anthropic':
        case 'google-vertex-anthropic':
          providerSpecificOptions = buildAnthropicProviderOptions(assistant, model, capabilities)
          break
        case 'bedrock':
          providerSpecificOptions = buildBedrockProviderOptions(assistant, model, capabilities)
          break
        case 'huggingface':
          providerSpecificOptions = buildOpenAIProviderOptions(assistant, model, capabilities, serviceTier)
          break
        case SystemProviderIds.ollama:
          providerSpecificOptions = buildOllamaProviderOptions(assistant, capabilities)
          break
        case SystemProviderIds.gateway:
          providerSpecificOptions = buildAIGatewayOptions(assistant, model, capabilities, serviceTier, textVerbosity)
          break
        default:
          // 对于其他 provider，使用通用的构建逻辑
          providerSpecificOptions = {
            [rawProviderId]: {
              ...buildGenericProviderOptions(assistant, model, capabilities),
              serviceTier,
              textVerbosity
            }
          }
      }
    } else {
      throw error
    }
  }

  /**
   * Retrieve custom parameters and separate standard parameters from provider-specific parameters.
   */
  const customParams = getCustomParameters(assistant)
  const { standardParams, providerParams } = extractAiSdkStandardParams(customParams) // 对于这里提取的providerParams，需要检测key是否是providerId

  /**
   * {
   *   gateway: { customOption1: value1, customOption2: value2 },
   *   customKey: customValue,
   * }
   */
  for (const key of Object.keys(providerParams)) {
    if (baseProviderIdSchema.safeParse(key).success || registeredNewProviderIdSchema.safeParse(key).success) {
      // Key is a provider ID, merge provider-specific options
      providerSpecificOptions = {
        ...providerSpecificOptions,
        [key]: {
          ...providerSpecificOptions[key],
          ...providerParams[key]
        }
      }
    } else {
      // Key is a custom parameter, add it to the current provider's options
      providerSpecificOptions = {
        ...providerSpecificOptions,
        [rawProviderId]: {
          ...providerSpecificOptions[rawProviderId],
          [key]: providerParams[key]
        }
      }
    }
  }

  // 返回 AI Core SDK 要求的格式：{ 'providerId': providerOptions } 以及提取的标准参数
  return {
    providerOptions: providerSpecificOptions,
    standardParams
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
  },
  serviceTier: OpenAIServiceTier,
  textVerbosity?: OpenAIVerbosity
): Record<string, OpenAIResponsesProviderOptions> {
  const { enableReasoning } = capabilities
  let providerOptions: OpenAIResponsesProviderOptions = {}
  // OpenAI 推理参数
  if (enableReasoning) {
    const reasoningParams = getOpenAIReasoningParams(assistant, model)
    providerOptions = {
      ...providerOptions,
      ...reasoningParams
    }
  }
  const provider = getProviderById(model.provider)

  if (!provider) {
    throw new Error(`Provider ${model.provider} not found`)
  }

  if (isSupportVerbosityModel(model) && isSupportVerbosityProvider(provider)) {
    const openAI = getStoreSetting<'openAI'>('openAI')
    const userVerbosity = openAI?.verbosity

    if (userVerbosity && ['low', 'medium', 'high'].includes(userVerbosity)) {
      const supportedVerbosity = getModelSupportedVerbosity(model)
      // Use user's verbosity if supported, otherwise use the first supported option
      const verbosity = supportedVerbosity.includes(userVerbosity) ? userVerbosity : supportedVerbosity[0]

      providerOptions = {
        ...providerOptions,
        textVerbosity: verbosity
      }
    }
  }

  providerOptions = {
    ...providerOptions,
    serviceTier,
    textVerbosity
  }

  return {
    openai: providerOptions
  }
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
): Record<string, AnthropicProviderOptions> {
  const { enableReasoning } = capabilities
  let providerOptions: AnthropicProviderOptions = {}

  // Anthropic 推理参数
  if (enableReasoning) {
    const reasoningParams = getAnthropicReasoningParams(assistant, model)
    providerOptions = {
      ...providerOptions,
      ...reasoningParams
    }
  }

  return {
    anthropic: {
      ...providerOptions
    }
  }
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
): Record<string, GoogleGenerativeAIProviderOptions> {
  const { enableReasoning, enableGenerateImage } = capabilities
  let providerOptions: GoogleGenerativeAIProviderOptions = {}

  // Gemini 推理参数
  if (enableReasoning) {
    const reasoningParams = getGeminiReasoningParams(assistant, model)
    providerOptions = {
      ...providerOptions,
      ...reasoningParams
    }
  }

  if (enableGenerateImage) {
    providerOptions = {
      ...providerOptions,
      ...buildGeminiGenerateImageParams()
    }
  }

  return {
    google: {
      ...providerOptions
    }
  }
}

function buildXAIProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  }
): Record<string, XaiProviderOptions> {
  const { enableReasoning } = capabilities
  let providerOptions: Record<string, any> = {}

  if (enableReasoning) {
    const reasoningParams = getXAIReasoningParams(assistant, model)
    providerOptions = {
      ...providerOptions,
      ...reasoningParams
    }
  }

  return {
    xai: {
      ...providerOptions
    }
  }
}

function buildCherryInProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  },
  actualProvider: Provider,
  serviceTier: OpenAIServiceTier,
  textVerbosity: OpenAIVerbosity
): Record<string, OpenAIResponsesProviderOptions | AnthropicProviderOptions | GoogleGenerativeAIProviderOptions> {
  switch (actualProvider.type) {
    case 'openai':
    case 'openai-response':
      return buildOpenAIProviderOptions(assistant, model, capabilities, serviceTier, textVerbosity)
    case 'anthropic':
      return buildAnthropicProviderOptions(assistant, model, capabilities)
    case 'gemini':
      return buildGeminiProviderOptions(assistant, model, capabilities)
  }
  return {}
}

/**
 * Build Bedrock providerOptions
 */
function buildBedrockProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  }
): Record<string, BedrockProviderOptions> {
  const { enableReasoning } = capabilities
  let providerOptions: BedrockProviderOptions = {}

  if (enableReasoning) {
    const reasoningParams = getBedrockReasoningParams(assistant, model)
    providerOptions = {
      ...providerOptions,
      ...reasoningParams
    }
  }

  const betaHeaders = addAnthropicHeaders(assistant, model)
  if (betaHeaders.length > 0) {
    providerOptions.anthropicBeta = betaHeaders
  }

  return {
    bedrock: providerOptions
  }
}

function buildOllamaProviderOptions(
  assistant: Assistant,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  }
): Record<string, OllamaCompletionProviderOptions> {
  const { enableReasoning } = capabilities
  const providerOptions: OllamaCompletionProviderOptions = {}
  const reasoningEffort = assistant.settings?.reasoning_effort
  if (enableReasoning) {
    providerOptions.think = !['none', undefined].includes(reasoningEffort)
  }
  return {
    ollama: providerOptions
  }
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

  // 特殊处理 Qwen MT
  if (isQwenMTModel(model)) {
    if (isTranslateAssistant(assistant)) {
      const targetLanguage = assistant.targetLanguage
      const translationOptions = {
        source_lang: 'auto',
        target_lang: mapLanguageToQwenMTModel(targetLanguage)
      } as const
      if (!translationOptions.target_lang) {
        throw new Error(t('translate.error.not_supported', { language: targetLanguage.value }))
      }
      providerOptions.translation_options = translationOptions
    } else {
      throw new Error(t('translate.error.chat_qwen_mt'))
    }
  }

  return providerOptions
}

function buildAIGatewayOptions(
  assistant: Assistant,
  model: Model,
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
  },
  serviceTier: OpenAIServiceTier,
  textVerbosity?: OpenAIVerbosity
): Record<
  string,
  | OpenAIResponsesProviderOptions
  | AnthropicProviderOptions
  | GoogleGenerativeAIProviderOptions
  | Record<string, unknown>
> {
  if (isAnthropicModel(model)) {
    return buildAnthropicProviderOptions(assistant, model, capabilities)
  } else if (isOpenAIModel(model)) {
    return buildOpenAIProviderOptions(assistant, model, capabilities, serviceTier, textVerbosity)
  } else if (isGeminiModel(model)) {
    return buildGeminiProviderOptions(assistant, model, capabilities)
  } else if (isGrokModel(model)) {
    return buildXAIProviderOptions(assistant, model, capabilities)
  } else {
    return {
      ['openai-compatible']: buildGenericProviderOptions(assistant, model, capabilities)
    }
  }
}
