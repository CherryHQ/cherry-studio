import type { BedrockProviderOptions } from '@ai-sdk/amazon-bedrock'
import { type AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { XaiResponsesProviderOptions } from '@ai-sdk/xai'
import type { JSONValue } from 'ai'
import { merge } from 'es-toolkit/compat'

import { loggerService } from '@logger'
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
import { isSupportFastMode, isSupportServiceTierProvider, isSupportVerbosityProvider } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import type { AppProviderId } from '../types'
import type { ProviderCapabilities } from '../types'
import { addAnthropicHeaders } from './anthropicHeaders'
import { buildGeminiGenerateImageParams } from './image'
import { encodeReasoningInvocation, type ResolvedReasoningInvocation } from './reasoningSerializers'
import { getWebSearchParams } from './websearch'

const logger = loggerService.withContext('aiCore.utils.options')

export function applyFastModeToProviderOptions(
  provider: Pick<Provider, 'fastMode'>,
  model: Pick<Model, 'supportsFastMode'>,
  providerOptions: ProviderOptions,
  fastMode: boolean
): ProviderOptions {
  if (!fastMode || !isSupportFastMode(provider, model) || provider.fastMode.transport !== 'openai-priority') {
    return providerOptions
  }

  return {
    ...providerOptions,
    openai: {
      ...providerOptions.openai,
      serviceTier: 'priority'
    }
  }
}

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

function shouldNormalizeOpenAICompatibleReasoning(
  providerId: AppProviderId,
  endpointType: EndpointType | undefined
): boolean {
  return (
    providerId === 'openai-compatible' ||
    providerId === 'github-copilot-openai-compatible' ||
    providerId === 'google-vertex-maas' ||
    (endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS &&
      (providerId === 'aihubmix' || providerId === SystemProviderIds.dmxapi))
  )
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
  model: Model,
  actualProvider: Provider,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>,
  context: {
    aiSdkProviderId: AppProviderId
    runtimeProviderId: AppProviderId
    providerOptionsKey: string
    endpointType: EndpointType | undefined
    reasoning: ResolvedReasoningInvocation
  }
): Record<string, Record<string, JSONValue>> {
  const rawProviderId = context.runtimeProviderId
  const providerOptionsKey = context.providerOptionsKey
  const serviceTier = getServiceTier(model, actualProvider)
  const textVerbosity = getVerbosity(model, actualProvider)
  const resolvedReasoningOptions = capabilities.enableReasoning
    ? encodeReasoningOptions(providerOptionsKey, context.reasoning)
    : {
        providerId: rawProviderId === 'openai-compatible' ? actualProvider.id : providerOptionsKey,
        options: {}
      }
  const reasoningOptions = shouldNormalizeOpenAICompatibleReasoning(rawProviderId, context.endpointType)
    ? { ...resolvedReasoningOptions, options: normalizeOpenAICompatibleParams(resolvedReasoningOptions.options) }
    : resolvedReasoningOptions

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
      providerSpecificOptions = buildAnthropicProviderOptions(reasoningOptions.options)
      break
    case 'google-vertex-anthropic':
      providerSpecificOptions = buildAnthropicProviderOptions(reasoningOptions.options, providerOptionsKey)
      break
    case 'google':
      providerSpecificOptions = buildGeminiProviderOptions(capabilities, reasoningOptions.options)
      break
    case 'google-vertex':
      providerSpecificOptions = buildGeminiProviderOptions(capabilities, reasoningOptions.options, providerOptionsKey)
      break
    case 'xai':
    case 'xai-responses':
      providerSpecificOptions = buildXAIProviderOptions(reasoningOptions.options)
      break
    case 'bedrock':
      providerSpecificOptions = buildBedrockProviderOptions(model, reasoningOptions.options)
      break
    case SystemProviderIds.ollama:
      providerSpecificOptions = buildOllamaProviderOptions(model, reasoningOptions.options)
      break
    case 'cherryin':
    case 'cherryin-chat':
    case 'newapi':
    case 'aihubmix':
    case SystemProviderIds.dmxapi:
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
    case 'google-vertex-maas':
    default:
      providerSpecificOptions = buildGenericProviderOptions(
        reasoningOptions.providerId,
        model,
        actualProvider,
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
  providerOptionsKey: string,
  invocation: ResolvedReasoningInvocation
): { providerId: string; options: Record<string, unknown> } {
  return { providerId: providerOptionsKey, options: encodeReasoningInvocation(invocation) }
}

/** Build the single providerOptions namespace that owns reasoning for this endpoint adapter. */
export function buildResolvedReasoningProviderOptions(context: {
  aiSdkProviderId: AppProviderId
  providerOptionsKey: string
  endpointType: EndpointType | undefined
  reasoning: ResolvedReasoningInvocation
}): Record<string, Record<string, unknown>> {
  const encoded = encodeReasoningOptions(context.providerOptionsKey, context.reasoning)
  const options = shouldNormalizeOpenAICompatibleReasoning(context.aiSdkProviderId, context.endpointType)
    ? normalizeOpenAICompatibleParams(encoded.options)
    : encoded.options
  return Object.keys(options).length > 0 ? { [encoded.providerId]: options } : {}
}

/** Whether a custom parameter key names a providerOptions namespace rather than a body field. */
export function isCustomProviderNamespace(
  key: string,
  providerOptions: Record<string, unknown>,
  rawProviderId: string
): boolean {
  return Object.hasOwn(providerOptions, key) || key === rawProviderId
}

/**
 * For `openai-compatible`, rename `reasoning_effort` → `reasoningEffort` —
 * AI SDK silently drops the snake_case form.
 * See https://github.com/CherryHQ/cherry-studio/issues/11987.
 */
export function mergeCustomProviderParameters(
  providerOptions: Record<string, Record<string, JSONValue>>,
  providerParams: Record<string, any>,
  rawProviderId: string,
  adapterFamily: AppProviderId = rawProviderId as AppProviderId
): Record<string, Record<string, JSONValue>> {
  const actualAiSdkProviderIds = Object.keys(providerOptions)
  const primaryAiSdkProviderId = actualAiSdkProviderIds[0]
  const normalizedProviderParams =
    adapterFamily === 'openai-compatible' ? normalizeOpenAICompatibleParams(providerParams) : providerParams

  let result = providerOptions
  for (const key of Object.keys(normalizedProviderParams)) {
    const isProviderNamespace = isCustomProviderNamespace(key, providerOptions, rawProviderId)
    const value =
      adapterFamily === 'openai-compatible' &&
      isProviderNamespace &&
      normalizedProviderParams[key] !== null &&
      typeof normalizedProviderParams[key] === 'object' &&
      !Array.isArray(normalizedProviderParams[key])
        ? normalizeOpenAICompatibleParams(normalizedProviderParams[key])
        : normalizedProviderParams[key]
    if (actualAiSdkProviderIds.includes(key)) {
      result = {
        ...result,
        [key]: {
          ...result[key],
          ...value
        }
      }
    } else if (key === rawProviderId && !actualAiSdkProviderIds.includes(rawProviderId)) {
      if (key === SystemProviderIds.gateway) {
        result = {
          ...result,
          [key]: {
            ...result[key],
            ...value
          }
        }
      } else {
        result = {
          ...result,
          [primaryAiSdkProviderId]: {
            ...result[primaryAiSdkProviderId],
            ...value
          }
        }
      }
    } else {
      result = {
        ...result,
        [primaryAiSdkProviderId]: {
          ...result[primaryAiSdkProviderId],
          [key]: value
        }
      }
    }
  }
  return result
}

function normalizeOpenAICompatibleParams(params: Record<string, any>): Record<string, any> {
  if (!('reasoning_effort' in params)) return params

  const normalized = { ...params }
  if (!('reasoningEffort' in normalized)) normalized.reasoningEffort = normalized.reasoning_effort
  delete normalized.reasoning_effort
  return normalized
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
  reasoningOptions: Record<string, unknown>,
  providerOptionsKey = 'anthropic'
): Record<string, AnthropicProviderOptions> {
  const providerOptions = { ...reasoningOptions } as AnthropicProviderOptions
  return { [providerOptionsKey]: { ...providerOptions } }
}

function buildGeminiProviderOptions(
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>,
  reasoningOptions: Record<string, unknown>,
  providerOptionsKey = 'google'
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
  return { [providerOptionsKey]: { ...providerOptions } }
}

function buildXAIProviderOptions(
  reasoningOptions: Record<string, unknown>
): Record<string, XaiResponsesProviderOptions> {
  return { xai: { ...reasoningOptions } }
}

function buildBedrockProviderOptions(
  model: Model,
  reasoningOptions: Record<string, unknown>
): Record<string, BedrockProviderOptions> {
  const providerOptions = { ...reasoningOptions } as BedrockProviderOptions
  const betaHeaders = addAnthropicHeaders(model)
  if (betaHeaders.length > 0) {
    providerOptions.anthropicBeta = betaHeaders
  }
  return { bedrock: providerOptions }
}

function buildOllamaProviderOptions(
  model: Model,
  reasoningOptions: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  return {
    ollama: {
      ...reasoningOptions,
      // Ollama defaults to a 2048-token context window unless num_ctx is supplied;
      // forward the model's configured contextWindow so large-context models are
      // not silently truncated.
      ...(model.contextWindow ? { options: { num_ctx: model.contextWindow } } : {})
    }
  }
}

function buildGenericProviderOptions(
  providerId: string,
  model: Model,
  provider: Provider,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>,
  reasoningOptions: Record<string, unknown>
): Record<string, any> {
  const { enableWebSearch } = capabilities
  let providerOptions: Record<string, any> = {}

  providerOptions = { ...providerOptions, ...reasoningOptions }

  if (enableWebSearch) {
    providerOptions = merge({}, providerOptions, getWebSearchParams(model, provider))
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
      return buildGenericProviderOptions(reasoning.providerId, model, provider, capabilities, reasoning.options)
  }
  return { [reasoning.providerId]: reasoning.options }
}
