import type { BedrockProviderOptions } from '@ai-sdk/amazon-bedrock'
import { type AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { XaiResponsesProviderOptions } from '@ai-sdk/xai'
import type { ResolvedServiceTierControl } from '@data/services/ProviderRegistryService'
import { loggerService } from '@logger'
import { ENDPOINT_TYPE, type EndpointType, type Model, type ServiceTierSelection } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { type AiSdkParam, isAiSdkParam } from '@shared/types/aiSdk'
import { isReasoningModel } from '@shared/utils/model'
import { isSupportFastMode } from '@shared/utils/provider'
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

export function applyFastModeToProviderOptions(
  provider: Pick<Provider, 'fastMode'>,
  model: Pick<Model, 'supportsFastMode'>,
  providerOptions: ProviderOptions,
  fastMode: boolean
): ProviderOptions {
  if (!fastMode || !isSupportFastMode(provider, model)) {
    return providerOptions
  }
  // 'claude-code' carries Fast inside the SDK, not through providerOptions.
  if (provider.fastMode.transport !== 'openai-priority') return providerOptions
  const serviceTier = provider.fastMode.serviceTier ?? 'priority'

  return {
    ...providerOptions,
    openai: {
      ...providerOptions.openai,
      serviceTier
    }
  }
}

export function resolveServiceTierWireValue(
  control: ResolvedServiceTierControl,
  selection: ServiceTierSelection | undefined
): string {
  const effective = selection && control.options.includes(selection) ? selection : control.default
  const value = control.wire.values[effective]
  if (!value) throw new Error(`Missing wire value for service tier '${effective}'`)
  return value
}

export function applyServiceTierToProviderOptions<T extends ProviderOptions>(
  providerOptions: T,
  providerOptionsKey: string,
  control: ResolvedServiceTierControl,
  selection: ServiceTierSelection | undefined
): T {
  if (control.wire.delivery.type === 'request-body') {
    const namespace = providerOptions[providerOptionsKey]
    if (!namespace || !Object.hasOwn(namespace, control.wire.delivery.key)) return providerOptions
    const cleanedNamespace = { ...namespace }
    delete cleanedNamespace[control.wire.delivery.key]
    return { ...providerOptions, [providerOptionsKey]: cleanedNamespace } as T
  }
  return {
    ...providerOptions,
    [providerOptionsKey]: {
      ...providerOptions[providerOptionsKey],
      [control.wire.delivery.key]: resolveServiceTierWireValue(control, selection)
    }
  } as T
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
      providerSpecificOptions = buildOpenAIProviderOptions(model, capabilities, reasoningOptions.options)
      break
    case 'open-responses':
      providerSpecificOptions = buildOpenResponsesProviderOptions(reasoningOptions.options)
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
  if (Object.keys(options).length === 0) return {}

  return {
    [encoded.providerId]: {
      ...options,
      ...(context.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES &&
        encoded.providerId === 'openai' && { forceReasoning: true })
    }
  }
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
 * For OpenAI-compatible adapter families, rename `reasoning_effort` → `reasoningEffort` —
 * AI SDK silently drops the snake_case form.
 *
 * Covers both `'openai-compatible'` (custom OpenAI-compatible providers, see #11987) and
 * `'github-copilot-openai-compatible'` (GitHub Copilot, see #11140) — both speak the
 * OpenAI Chat Completions dialect and silently drop snake_case reasoning keys.
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
    adapterFamily === 'openai-compatible' || adapterFamily === 'github-copilot-openai-compatible'
      ? normalizeOpenAICompatibleParams(providerParams)
      : providerParams

  let result = providerOptions
  for (const key of Object.keys(normalizedProviderParams)) {
    const isProviderNamespace = isCustomProviderNamespace(key, providerOptions, rawProviderId)
    const value =
      (adapterFamily === 'openai-compatible' || adapterFamily === 'github-copilot-openai-compatible') &&
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
  reasoningOptions: Record<string, unknown>
): Record<string, OpenAIResponsesProviderOptions> {
  const { enableReasoning } = capabilities
  let providerOptions: OpenAIResponsesProviderOptions = {}
  if (enableReasoning) {
    providerOptions = {
      ...providerOptions,
      ...reasoningOptions,
      // Non-allowlisted ids still served by @ai-sdk/openai (grok-cli's grok models,
      // relay gpt aliases) need the model-id allowlist bypass.
      ...(isReasoningModel(model) && { forceReasoning: true })
    }
  }

  return { openai: { ...providerOptions, store: false } }
}

/**
 * Options for `@ai-sdk/open-responses` models (namespace 'openai' via `name: 'openai'`).
 * The package accepts only `reasoningEffort`/`reasoningSummary` — OpenAI-only keys
 * (store/serviceTier/textVerbosity/forceReasoning) are deliberately not sent.
 */
function buildOpenResponsesProviderOptions(
  reasoningOptions: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  return { openai: { ...reasoningOptions } }
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
      // Forward the model's context window so large-context models are not silently
      // truncated. Omitting it is deliberate when unknown: Ollama then sizes by available
      // VRAM (4k / 32k / 256k), which beats any fixed guess we could substitute.
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
      return buildOpenAIProviderOptions(model, capabilities, reasoning.options)
    case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
    case ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION:
      return buildGenericProviderOptions(reasoning.providerId, model, provider, capabilities, reasoning.options)
  }
  return { [reasoning.providerId]: reasoning.options }
}
