/**
 * Provider-options builder for the AI SDK request.
 *
 * Split into two layers by who owns them:
 *
 * 1. `buildCapabilityProviderOptions` — capability-driven. Per-provider
 *    dispatch that produces `{ providerId: providerOptions }` based on
 *    `(assistant, model, provider, capabilities)`. Covers reasoning params,
 *    service tier, verbosity, generate-image flags.
 *
 *    Called once by `AiService.buildAgentParams` and written directly to
 *    `AgentOptions.providerOptions` — these values are stable for the
 *    (assistant, model, provider, capabilities) tuple, so they live at the
 *    agent level, not per streamText call.
 *
 * 2. `extractAiSdkStandardParams` + `mergeCustomProviderParameters` —
 *    user-input-driven. Splits `assistant.settings.customParameters` into
 *    AI-SDK standard params (topK, frequencyPenalty, etc.) and provider
 *    params, then layers the provider params onto an existing
 *    providerOptions map.
 *
 *    Also consumed by `AiService.buildAgentParams` — user customParameters
 *    share the assistant's lifetime, so they're treated as agent-level
 *    config and written into `AgentOptions` alongside the capability defaults
 *    rather than layered per-call via `transformParams`.
 *
 * Ported from renderer `aiCore/utils/options.ts` (origin/main). Differences:
 *   - `AiSdkParam` / `OpenAIVerbosity` types now come from `@shared/types/aiSdk`
 *     (moved out of the renderer).
 *   - The Qwen-MT `translation_options` branch is deleted — v2 translate is
 *     its own entity (`packages/shared/data/types/translate.ts`) with its own
 *     request flow, not a field on the chat `Assistant`. When translate-on-
 *     Main lands it will inject `target_lang` from the translate handler, not
 *     from here.
 */

import type { BedrockProviderOptions } from '@ai-sdk/amazon-bedrock'
import { type AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { XaiProviderOptions } from '@ai-sdk/xai'
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
import { SystemProviderIds } from '@types'
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

// Local type aliases for v2 Provider compatibility (replacing v1 GroqSystemProvider/NotGroqProvider)
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
  // Non-Groq OpenAI-family providers — assume same service tier semantics as OpenAI.
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

/**
 * Split a flat custom-parameters map into:
 *   - `standardParams`: the AI SDK "standard" request fields (temperature,
 *     topK, frequencyPenalty, etc.) that live on `params` root.
 *   - `providerParams`: everything else, destined for
 *     `params.providerOptions[providerId]`.
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
 * Capability-driven provider options — per-provider dispatch producing the
 * `{ providerId: providerOptions }` blob for the AI SDK request.
 *
 * Does NOT read `assistant.settings.customParameters`. Customer parameters
 * are layered separately by `mergeCustomProviderParameters` so plugins can
 * keep the two concerns isolated.
 */
export function buildCapabilityProviderOptions(
  assistant: Assistant,
  model: Model,
  actualProvider: Provider,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>
): Record<string, Record<string, JSONValue>> {
  const rawProviderId = getAiSdkProviderId(actualProvider)
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
 * Layer user-supplied `providerParams` onto an existing provider-options map.
 *
 * Key routing (matches renderer origin/main semantics):
 *   1. Key ∈ actualAiSdkProviderIds → merge directly (user knows the actual
 *      AI SDK provider ID).
 *   2. Key == rawProviderId, not in actualAiSdkProviderIds:
 *      - gateway / ollama → preserve (routing / serving config).
 *      - Otherwise → map onto primary AI SDK provider (proxy case — cherryin).
 *   3. Otherwise → merge to primary provider as a regular parameter.
 *
 * For `openai-compatible` providers, the `reasoning_effort` (snake_case) key
 * is auto-renamed to `reasoningEffort` (camelCase) — the AI SDK's
 * openai-compatible provider silently drops the snake_case form. See
 * https://github.com/CherryHQ/cherry-studio/issues/11987.
 */
export function mergeCustomProviderParameters(
  providerOptions: Record<string, Record<string, JSONValue>>,
  providerParams: Record<string, any>,
  rawProviderId: string
): Record<string, Record<string, JSONValue>> {
  const actualAiSdkProviderIds = Object.keys(providerOptions)
  const primaryAiSdkProviderId = actualAiSdkProviderIds[0]

  // Key rename patch for openai-compatible.
  if (primaryAiSdkProviderId === 'openai-compatible' && 'reasoning_effort' in providerParams) {
    if (!('reasoningEffort' in providerParams)) {
      providerParams.reasoningEffort = providerParams.reasoning_effort
    }
    delete providerParams.reasoning_effort
  }

  let result = providerOptions
  for (const key of Object.keys(providerParams)) {
    if (actualAiSdkProviderIds.includes(key)) {
      // Case 1: Key is an actual AI SDK provider ID.
      result = {
        ...result,
        [key]: {
          ...result[key],
          ...providerParams[key]
        }
      }
    } else if (key === rawProviderId && !actualAiSdkProviderIds.includes(rawProviderId)) {
      // Case 2: proxy / special provider.
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
      // Case 3: regular parameter.
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

/** OpenAI-family (openai / azure / huggingface / openai-chat) options. */
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
    const reasoningParams = getOpenAIReasoningParams(assistant, model)
    providerOptions = {
      ...providerOptions,
      ...reasoningParams,
      // TODO: Remove after migrating to @ai-sdk/open-responses (#13462).
      // Bypass @ai-sdk/openai's model-ID allowlist for reasoning detection.
      // Third-party providers often use non-canonical model IDs (e.g. "openai/gpt-5.2")
      // that fail the SDK's startsWith() checks, silently dropping reasoning params.
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

  // TODO: support configurable server-side persistence.
  providerOptions = {
    ...providerOptions,
    serviceTier,
    textVerbosity,
    store: false
  }
  return { openai: providerOptions }
}

/** Anthropic-family options (direct + Azure-Anthropic + Vertex-Anthropic). */
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

/** Gemini / Vertex-Gemini options. */
function buildGeminiProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>
): Record<string, GoogleGenerativeAIProviderOptions> {
  const { enableReasoning, enableGenerateImage } = capabilities
  let providerOptions: GoogleGenerativeAIProviderOptions = {}
  if (enableReasoning) {
    const reasoningParams = getGeminiReasoningParams(assistant, model)
    providerOptions = { ...providerOptions, ...reasoningParams }
  }
  if (enableGenerateImage) {
    providerOptions = { ...providerOptions, ...buildGeminiGenerateImageParams() }
  }
  return { google: { ...providerOptions } }
}

/** XAI Grok options. */
function buildXAIProviderOptions(
  assistant: Assistant,
  model: Model,
  capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>
): Record<string, XaiProviderOptions> {
  const { enableReasoning } = capabilities
  let providerOptions: Record<string, any> = {}
  if (enableReasoning) {
    providerOptions = { ...providerOptions, ...getXAIReasoningParams(assistant, model) }
  }
  return { xai: { ...providerOptions } }
}

/** AWS Bedrock options — reasoning via Anthropic shape + beta headers. */
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

/** Ollama options. */
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

/** Generic fallback — covers deepseek / openrouter / openai-compatible / etc. */
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

/**
 * AI Gateway — covers CherryIN, NewAPI, AiHubMix, Vercel Gateway.
 *
 * Proxy providers annotate `model.endpointTypes[0]` to force a specific
 * protocol; the returned `providerOptions` key must align with the
 * language-model class each SDK layer builds, or AI SDK silently drops the
 * custom options. See:
 *   - packages/ai-sdk-provider/src/cherryin-provider.ts (createChatModel)
 *   - src/renderer/src/aiCore/provider/custom/newapi-provider.ts (createChatModel)
 *
 *   endpointTypes[0]            | SDK language-model class           | providerOptions key
 *   ----------------------------+------------------------------------+----------------------
 *   'anthropic-messages'        | AnthropicMessagesLanguageModel     | anthropic
 *   'google-generate-content'   | GoogleGenerativeAILanguageModel    | google
 *   'openai-responses'          | OpenAIResponsesLanguageModel       | openai
 *   'openai-chat-completions'   | OpenAICompatibleChatLanguageModel  | openai-compatible
 *   'openai-image-generation'   | OpenAICompatibleChatLanguageModel  | openai-compatible
 *
 * Fallback (for untagged models / Vercel Gateway / AiHubMix) dispatches on
 * model-name heuristics.
 */
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

  // Fallback: model-name heuristic (covers Vercel Gateway, AiHubMix, and untagged models)
  if (isAnthropicModel(model)) return buildAnthropicProviderOptions(assistant, model, capabilities)
  if (isOpenAIModel(model))
    return buildOpenAIProviderOptions(assistant, model, capabilities, provider, serviceTier, textVerbosity)
  if (isGeminiModel(model)) return buildGeminiProviderOptions(assistant, model, capabilities)
  if (isGrokModel(model)) return buildXAIProviderOptions(assistant, model, capabilities)
  return buildGenericProviderOptions('openai-compatible', assistant, model, capabilities, provider)
}
