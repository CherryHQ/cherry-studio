import type { BedrockProviderOptions } from '@ai-sdk/amazon-bedrock'
import { type AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { XaiResponsesProviderOptions } from '@ai-sdk/xai'
import { loggerService } from '@logger'
import type { Assistant } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import {
  type GroqServiceTier,
  GroqServiceTiers,
  isGroqServiceTier,
  isOpenAIServiceTier,
  type OpenAIServiceTier,
  OpenAIServiceTiers,
  type Provider,
  type ServiceTier
} from '@shared/data/types/provider'
import { type AiSdkParam, isAiSdkParam, type OpenAIVerbosity } from '@shared/types/aiSdk'
import {
  getModelSupportedVerbosity,
  isAnthropicModel,
  isGeminiModel,
  isGrokModel,
  isOpenAIModel,
  isReasoningModel,
  isSupportFlexServiceTierModel,
  isSupportVerbosityModel
} from '@shared/utils/model'
import { isSupportServiceTierProvider, isSupportVerbosityProvider } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import type { JSONValue } from 'ai'
import { merge } from 'lodash'
import type { OllamaProviderOptions } from 'ollama-ai-provider-v2'

import { getAiSdkProviderId } from '../provider/factory'
import type { ProviderCapabilities } from '../types'
import { addAnthropicHeaders } from './anthropicHeaders'
import { buildGeminiGenerateImageParams } from './image'
import {
  getAnthropicReasoningParams,
  getBedrockReasoningParams,
  getGeminiReasoningParams,
  getOllamaReasoningParams,
  getOpenAIReasoningParams,
  getReasoningEffort,
  getXAIReasoningParams
} from './reasoning'
import { getWebSearchParams } from './websearch'

const logger = loggerService.withContext('aiCore.utils.options')

type GroqProvider = Provider & { id: 'groq' }
type NonGroqProvider = Provider & { id: Exclude<string, 'groq'> }

function isGroqProvider(provider: Provider): provider is GroqProvider {
  return provider.id === SystemProviderIds.groq
}

function toOpenAIServiceTier(model: Model, serviceTier: ServiceTier): OpenAIServiceTier {
  if (
    !isOpenAIServiceTier(serviceTier) ||
    (serviceTier === OpenAIServiceTiers.flex && !isSupportFlexServiceTierModel(model))
  ) {
    return undefined
  }
  return serviceTier
}

function toGroqServiceTier(model: Model, serviceTier: ServiceTier): GroqServiceTier {
  if (
    !isGroqServiceTier(serviceTier) ||
    (serviceTier === GroqServiceTiers.flex && !isSupportFlexServiceTierModel(model))
  ) {
    return undefined
  }
  return serviceTier
}

function getServiceTier<T extends GroqProvider>(model: Model, provider: T): GroqServiceTier
function getServiceTier<T extends NonGroqProvider>(model: Model, provider: T): OpenAIServiceTier
function getServiceTier<T extends Provider>(model: Model, provider: T): OpenAIServiceTier | GroqServiceTier {
  const serviceTierSetting = provider.settings.serviceTier as ServiceTier | undefined

  if (!isSupportServiceTierProvider(provider) || !isOpenAIModel(model) || !serviceTierSetting) {
    return undefined
  }

  if (isGroqProvider(provider)) {
    return toGroqServiceTier(model, serviceTierSetting)
  }
  return toOpenAIServiceTier(model, serviceTierSetting)
}

function getVerbosity(model: Model, provider: Provider): OpenAIVerbosity {
  if (!isSupportVerbosityModel(model) || !isSupportVerbosityProvider(provider)) {
    return undefined
  }

  const userVerbosity = provider.settings.verbosity as OpenAIVerbosity

  if (userVerbosity) {
    const supportedVerbosity = getModelSupportedVerbosity(model)
    return supportedVerbosity.includes(userVerbosity) ? userVerbosity : (supportedVerbosity[0] as OpenAIVerbosity)
  }
  return undefined
}

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

export function buildCapabilityProviderOptions(
  assistant: Assistant,
  model: Model,
  actualProvider: Provider,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>
): Record<string, Record<string, JSONValue>> {
  const rawProviderId = getAiSdkProviderId(actualProvider, model)
  const serviceTier = getServiceTier(model, actualProvider)
  const textVerbosity = getVerbosity(model, actualProvider)

  let providerSpecificOptions: Record<string, any> = {}

  switch (rawProviderId) {
    case 'openai':
    case 'openai-chat':
    case 'azure':
    case 'azure-responses':
    case 'huggingface':
      providerSpecificOptions = buildOpenAIProviderOptions(
        assistant,
        model,
        capabilities,
        actualProvider,
        serviceTier,
        textVerbosity
      )
      break
    case 'anthropic':
    case 'azure-anthropic':
    case 'google-vertex-anthropic':
      providerSpecificOptions = buildAnthropicProviderOptions(assistant, model, capabilities)
      break
    case 'google':
    case 'google-vertex':
      providerSpecificOptions = buildGeminiProviderOptions(assistant, model, capabilities)
      break
    case 'xai':
    case 'xai-responses':
      providerSpecificOptions = buildXAIProviderOptions(assistant, model, capabilities)
      break
    case 'bedrock':
      providerSpecificOptions = buildBedrockProviderOptions(assistant, model, capabilities)
      break
    case SystemProviderIds.ollama:
      providerSpecificOptions = buildOllamaProviderOptions(assistant, model, capabilities)
      break
    case 'cherryin':
    case 'newapi':
    case 'aihubmix':
    case SystemProviderIds.gateway:
      providerSpecificOptions = buildAIGatewayOptions(
        assistant,
        model,
        capabilities,
        actualProvider,
        serviceTier,
        textVerbosity
      )
      break
    case 'deepseek':
    case 'openrouter':
    case 'openai-compatible':
    default:
      providerSpecificOptions = buildGenericProviderOptions(
        rawProviderId,
        assistant,
        model,
        capabilities,
        actualProvider
      )
      providerSpecificOptions = {
        ...providerSpecificOptions,
        [rawProviderId]: {
          ...providerSpecificOptions[rawProviderId],
          serviceTier,
          textVerbosity
        }
      }
      break
  }

  logger.debug('buildCapabilityProviderOptions', {
    rawProviderId,
    capabilities,
    providerSpecificOptions
  })
  return providerSpecificOptions
}

/**
 * For `openai-compatible`, rename `reasoning_effort` → `reasoningEffort` —
 * AI SDK silently drops the snake_case form.
 * See https://github.com/CherryHQ/cherry-studio/issues/11987.
 */
export function mergeCustomProviderParameters(
  providerOptions: Record<string, Record<string, JSONValue>>,
  providerParams: Record<string, any>,
  rawProviderId: string
): Record<string, Record<string, JSONValue>> {
  const actualAiSdkProviderIds = Object.keys(providerOptions)
  const primaryAiSdkProviderId = actualAiSdkProviderIds[0]

  if (primaryAiSdkProviderId === 'openai-compatible' && 'reasoning_effort' in providerParams) {
    if (!('reasoningEffort' in providerParams)) {
      providerParams.reasoningEffort = providerParams.reasoning_effort
    }
    delete providerParams.reasoning_effort
  }

  let result = providerOptions
  for (const key of Object.keys(providerParams)) {
    if (actualAiSdkProviderIds.includes(key)) {
      result = {
        ...result,
        [key]: {
          ...result[key],
          ...providerParams[key]
        }
      }
    } else if (key === rawProviderId && !actualAiSdkProviderIds.includes(rawProviderId)) {
      if (key === SystemProviderIds.gateway) {
        result = {
          ...result,
          [key]: {
            ...result[key],
            ...providerParams[key]
          }
        }
      } else {
        result = {
          ...result,
          [primaryAiSdkProviderId]: {
            ...result[primaryAiSdkProviderId],
            ...providerParams[key]
          }
        }
      }
    } else {
      result = {
        ...result,
        [primaryAiSdkProviderId]: {
          ...result[primaryAiSdkProviderId],
          [key]: providerParams[key]
        }
      }
    }
  }
  return result
}

function buildOpenAIProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>,
  provider: Provider,
  serviceTier: OpenAIServiceTier,
  textVerbosity?: OpenAIVerbosity
): Record<string, OpenAIResponsesProviderOptions> {
  const { enableReasoning } = capabilities
  let providerOptions: OpenAIResponsesProviderOptions = {}
  if (enableReasoning) {
    const reasoningParams = getOpenAIReasoningParams(assistant, model, {
      summaryText: provider.settings.summaryText
    })
    providerOptions = {
      ...providerOptions,
      ...reasoningParams,
      // TODO: Remove after migrating to @ai-sdk/open-responses (#13462).
      ...(isReasoningModel(model) && { forceReasoning: true })
    }
  }

  if (isSupportVerbosityModel(model) && isSupportVerbosityProvider(provider)) {
    const userVerbosity = provider.settings.verbosity as OpenAIVerbosity
    if (userVerbosity && ['low', 'medium', 'high'].includes(userVerbosity)) {
      const supportedVerbosity = getModelSupportedVerbosity(model)
      const verbosity = supportedVerbosity.includes(userVerbosity)
        ? userVerbosity
        : (supportedVerbosity[0] as OpenAIVerbosity)
      providerOptions = {
        ...providerOptions,
        textVerbosity: verbosity
      }
    }
  }

  providerOptions = {
    ...providerOptions,
    serviceTier,
    textVerbosity,
    store: false
  }
  return { openai: providerOptions }
}

function buildAnthropicProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>
): Record<string, AnthropicProviderOptions> {
  const { enableReasoning } = capabilities
  let providerOptions: AnthropicProviderOptions = {}
  if (enableReasoning) {
    const reasoningParams = getAnthropicReasoningParams(assistant, model)
    providerOptions = { ...providerOptions, ...reasoningParams }
  }
  return { anthropic: { ...providerOptions } }
}

function buildGeminiProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>
): Record<string, GoogleGenerativeAIProviderOptions> {
  const { enableReasoning, enableGenerateImage } = capabilities
  let providerOptions: GoogleGenerativeAIProviderOptions = {
    safetySettings: [
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_NONE'
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_NONE'
      },
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_NONE'
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_NONE'
      },
      {
        category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
        threshold: 'BLOCK_NONE'
      }
    ]
  }
  if (enableReasoning) {
    const reasoningParams = getGeminiReasoningParams(assistant, model)
    providerOptions = { ...providerOptions, ...reasoningParams }
  }
  if (enableGenerateImage) {
    providerOptions = { ...providerOptions, ...buildGeminiGenerateImageParams() }
  }
  return { google: { ...providerOptions } }
}

function buildXAIProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>
): Record<string, XaiResponsesProviderOptions> {
  const { enableReasoning } = capabilities
  let providerOptions: Record<string, any> = {}
  if (enableReasoning) {
    providerOptions = { ...providerOptions, ...getXAIReasoningParams(assistant, model) }
  }
  return { xai: { ...providerOptions } }
}

function buildBedrockProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>
): Record<string, BedrockProviderOptions> {
  const { enableReasoning } = capabilities
  let providerOptions: BedrockProviderOptions = {}
  if (enableReasoning) {
    providerOptions = { ...providerOptions, ...getBedrockReasoningParams(assistant, model) }
  }
  const betaHeaders = addAnthropicHeaders(assistant, model)
  if (betaHeaders.length > 0) {
    providerOptions.anthropicBeta = betaHeaders
  }
  return { bedrock: providerOptions }
}

function buildOllamaProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>
): Record<string, OllamaProviderOptions> {
  const { enableReasoning } = capabilities
  let options: Record<string, any> = {}
  if (enableReasoning) {
    options = { ...options, ...getOllamaReasoningParams(assistant, model) }
  }
  return { ollama: options }
}

function buildGenericProviderOptions(
  providerId: string,
  assistant: Assistant,
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>,
  provider: Provider
): Record<string, any> {
  const { enableWebSearch } = capabilities
  let providerOptions: Record<string, any> = {}

  const reasoningParams = getReasoningEffort(assistant, model, provider)
  providerOptions = { ...providerOptions, ...reasoningParams }

  if (enableWebSearch) {
    providerOptions = merge({}, providerOptions, getWebSearchParams(model))
  }

  return { [providerId]: providerOptions }
}

function buildAIGatewayOptions(
  assistant: Assistant,
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>,
  provider: Provider,
  serviceTier: OpenAIServiceTier,
  textVerbosity?: OpenAIVerbosity
): Record<
  string,
  | OpenAIResponsesProviderOptions
  | AnthropicProviderOptions
  | GoogleGenerativeAIProviderOptions
  | Record<string, unknown>
> {
  switch (model.endpointTypes?.[0]) {
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return buildAnthropicProviderOptions(assistant, model, capabilities)
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return buildGeminiProviderOptions(assistant, model, capabilities)
    case ENDPOINT_TYPE.OPENAI_RESPONSES:
      return buildOpenAIProviderOptions(assistant, model, capabilities, provider, serviceTier, textVerbosity)
    case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
    case ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION:
      return buildGenericProviderOptions('openai-compatible', assistant, model, capabilities, provider)
  }

  if (isAnthropicModel(model)) return buildAnthropicProviderOptions(assistant, model, capabilities)
  if (isOpenAIModel(model))
    return buildOpenAIProviderOptions(assistant, model, capabilities, provider, serviceTier, textVerbosity)
  if (isGeminiModel(model)) return buildGeminiProviderOptions(assistant, model, capabilities)
  if (isGrokModel(model)) return buildXAIProviderOptions(assistant, model, capabilities)
  return buildGenericProviderOptions('openai-compatible', assistant, model, capabilities, provider)
}
