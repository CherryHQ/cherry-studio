import type { BedrockProviderOptions } from '@ai-sdk/amazon-bedrock'
import { type AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { XaiResponsesProviderOptions } from '@ai-sdk/xai'
import { loggerService } from '@logger'
import type { Assistant } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
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
  isOpenAIModel,
  isReasoningModel,
  isSupportFlexServiceTierModel,
  isSupportVerbosityModel
} from '@shared/utils/model'
import { isSupportServiceTierProvider, isSupportVerbosityProvider } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import type { JSONValue } from 'ai'
import { merge } from 'es-toolkit/compat'

import type { AppProviderId } from '../types'
import type { ProviderCapabilities } from '../types'
import { addAnthropicHeaders } from './anthropicHeaders'
import { buildGeminiGenerateImageParams } from './image'
import { encodeReasoningInvocation, type ResolvedReasoningInvocation } from './reasoningSerializers'
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
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>,
  context: {
    aiSdkProviderId: AppProviderId
    endpointType: EndpointType | undefined
    reasoning: ResolvedReasoningInvocation
  }
): Record<string, Record<string, JSONValue>> {
  const rawProviderId = context.aiSdkProviderId
  const serviceTier = getServiceTier(model, actualProvider)
  const textVerbosity = getVerbosity(model, actualProvider)
  const reasoningOptions = capabilities.enableReasoning
    ? encodeReasoningOptions(rawProviderId, context.endpointType, context.reasoning, actualProvider.id)
    : {
        providerId: rawProviderId === 'openai-compatible' ? actualProvider.id : rawProviderId,
        options: {}
      }

  let providerSpecificOptions: Record<string, any> = {}

  switch (rawProviderId) {
    case 'openai':
    case 'openai-chat':
    case 'azure':
    case 'azure-responses':
    case 'huggingface':
      providerSpecificOptions = buildOpenAIProviderOptions(
        model,
        capabilities,
        actualProvider,
        serviceTier,
        textVerbosity,
        reasoningOptions.options
      )
      break
    case 'anthropic':
    case 'azure-anthropic':
    case 'google-vertex-anthropic':
      providerSpecificOptions = buildAnthropicProviderOptions(reasoningOptions.options)
      break
    case 'google':
    case 'google-vertex':
      providerSpecificOptions = buildGeminiProviderOptions(capabilities, reasoningOptions.options)
      break
    case 'xai':
    case 'xai-responses':
      providerSpecificOptions = buildXAIProviderOptions(reasoningOptions.options)
      break
    case 'bedrock':
      providerSpecificOptions = buildBedrockProviderOptions(assistant, model, reasoningOptions.options)
      break
    case SystemProviderIds.ollama:
      providerSpecificOptions = buildOllamaProviderOptions(reasoningOptions.options)
      break
    case 'cherryin':
    case 'cherryin-chat':
    case 'newapi':
    case 'aihubmix':
    case SystemProviderIds.gateway:
      providerSpecificOptions = buildAIGatewayOptions(
        model,
        capabilities,
        actualProvider,
        serviceTier,
        textVerbosity,
        context.endpointType,
        reasoningOptions
      )
      break
    case 'deepseek':
    case 'openrouter':
    case 'openai-compatible':
    default:
      providerSpecificOptions = buildGenericProviderOptions(
        reasoningOptions.providerId,
        model,
        capabilities,
        reasoningOptions.options
      )
      providerSpecificOptions = {
        ...providerSpecificOptions,
        [reasoningOptions.providerId]: {
          ...providerSpecificOptions[reasoningOptions.providerId],
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

function encodeReasoningOptions(
  aiSdkProviderId: AppProviderId,
  endpointType: EndpointType | undefined,
  invocation: ResolvedReasoningInvocation,
  actualProviderId?: string
): { providerId: string; options: Record<string, unknown> } {
  let providerId: string
  switch (aiSdkProviderId) {
    case 'openai':
    case 'openai-chat':
    case 'azure':
    case 'azure-responses':
    case 'huggingface':
      providerId = 'openai'
      break
    case 'anthropic':
    case 'azure-anthropic':
    case 'google-vertex-anthropic':
      providerId = 'anthropic'
      break
    case 'google':
    case 'google-vertex':
      providerId = 'google'
      break
    case 'xai':
    case 'xai-responses':
      providerId = 'xai'
      break
    case 'bedrock':
      providerId = 'bedrock'
      break
    case SystemProviderIds.ollama:
      providerId = 'ollama'
      break
    case 'cherryin':
    case 'cherryin-chat':
    case 'newapi':
    case 'aihubmix':
    case SystemProviderIds.gateway:
      if (endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) {
        providerId = 'anthropic'
      } else if (endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) {
        providerId = 'google'
      } else if (endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) {
        providerId = 'openai'
      } else {
        providerId = aiSdkProviderId
      }
      break
    case 'openai-compatible':
      // createOpenAICompatible() names the language model after the concrete
      // provider. Unknown compatible fields are forwarded only from that
      // namespace; the canonical openai-compatible namespace is schema-stripped.
      providerId = actualProviderId ?? aiSdkProviderId
      break
    default:
      providerId = aiSdkProviderId
  }
  return { providerId, options: encodeReasoningInvocation(invocation) }
}

/** Build the single providerOptions namespace that owns reasoning for this endpoint adapter. */
export function buildResolvedReasoningProviderOptions(context: {
  aiSdkProviderId: AppProviderId
  endpointType: EndpointType | undefined
  reasoning: ResolvedReasoningInvocation
  actualProviderId?: string
}): Record<string, Record<string, unknown>> {
  const encoded = encodeReasoningOptions(
    context.aiSdkProviderId,
    context.endpointType,
    context.reasoning,
    context.actualProviderId
  )
  return Object.keys(encoded.options).length > 0 ? { [encoded.providerId]: encoded.options } : {}
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
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>,
  provider: Provider,
  serviceTier: OpenAIServiceTier,
  textVerbosity: OpenAIVerbosity | undefined,
  reasoningOptions: Record<string, unknown>
): Record<string, OpenAIResponsesProviderOptions> {
  const { enableReasoning } = capabilities
  let providerOptions: OpenAIResponsesProviderOptions = {}
  if (enableReasoning) {
    providerOptions = {
      ...providerOptions,
      ...reasoningOptions,
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
  reasoningOptions: Record<string, unknown>
): Record<string, AnthropicProviderOptions> {
  const providerOptions = { ...reasoningOptions } as AnthropicProviderOptions
  return { anthropic: { ...providerOptions } }
}

function buildGeminiProviderOptions(
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>,
  reasoningOptions: Record<string, unknown>
): Record<string, GoogleGenerativeAIProviderOptions> {
  const { enableGenerateImage } = capabilities
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
  providerOptions = { ...providerOptions, ...reasoningOptions }
  if (enableGenerateImage) {
    providerOptions = { ...providerOptions, ...buildGeminiGenerateImageParams() }
  }
  return { google: { ...providerOptions } }
}

function buildXAIProviderOptions(
  reasoningOptions: Record<string, unknown>
): Record<string, XaiResponsesProviderOptions> {
  return { xai: { ...reasoningOptions } }
}

function buildBedrockProviderOptions(
  assistant: Assistant,
  model: Model,
  reasoningOptions: Record<string, unknown>
): Record<string, BedrockProviderOptions> {
  const providerOptions = { ...reasoningOptions } as BedrockProviderOptions
  const betaHeaders = addAnthropicHeaders(assistant, model)
  if (betaHeaders.length > 0) {
    providerOptions.anthropicBeta = betaHeaders
  }
  return { bedrock: providerOptions }
}

function buildOllamaProviderOptions(
  reasoningOptions: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  return { ollama: reasoningOptions }
}

function buildGenericProviderOptions(
  providerId: string,
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>,
  reasoningOptions: Record<string, unknown>
): Record<string, any> {
  const { enableWebSearch } = capabilities
  let providerOptions: Record<string, any> = {}

  providerOptions = { ...providerOptions, ...reasoningOptions }

  if (enableWebSearch) {
    providerOptions = merge({}, providerOptions, getWebSearchParams(model))
  }

  return { [providerId]: providerOptions }
}

function buildAIGatewayOptions(
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>,
  provider: Provider,
  serviceTier: OpenAIServiceTier,
  textVerbosity: OpenAIVerbosity | undefined,
  endpointType: EndpointType | undefined,
  reasoning: { providerId: string; options: Record<string, unknown> }
): Record<
  string,
  | OpenAIResponsesProviderOptions
  | AnthropicProviderOptions
  | GoogleGenerativeAIProviderOptions
  | Record<string, unknown>
> {
  switch (endpointType) {
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return buildAnthropicProviderOptions(reasoning.options)
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return buildGeminiProviderOptions(capabilities, reasoning.options)
    case ENDPOINT_TYPE.OPENAI_RESPONSES:
      return buildOpenAIProviderOptions(model, capabilities, provider, serviceTier, textVerbosity, reasoning.options)
    case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
    case ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION:
      return buildGenericProviderOptions(reasoning.providerId, model, capabilities, reasoning.options)
  }
  return { [reasoning.providerId]: reasoning.options }
}
