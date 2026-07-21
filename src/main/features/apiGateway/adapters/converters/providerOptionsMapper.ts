/**
 * Provider Options Mapper
 *
 * Normalizes reasoning controls from each gateway input dialect, then routes
 * them through the same descriptor-driven builders as Cherry's native chat
 * path. Native Anthropic and Gemini requests keep a lossless fast path when
 * the target speaks the same dialect.
 */

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'
import type { ReasoningEffort } from '@cherrystudio/openai/resources'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { getAiSdkProviderId } from '@main/ai/provider/factory'
import {
  getAnthropicReasoningParams,
  getBedrockReasoningParams,
  getGeminiReasoningParams,
  getOllamaReasoningParams,
  getOpenAIReasoningParams,
  getReasoningEffort,
  getXAIReasoningParams
} from '@main/ai/utils/reasoning'
import { nearestEffortForBudget } from '@shared/ai/reasoningBudget'
import type { Assistant } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

// Re-export for use by message converters.
export type { ReasoningEffort }

type GatewayReasoningEffort = ReasoningEffortOption | string
type GeminiThinkingConfig = { includeThoughts?: boolean; thinkingBudget?: number; thinkingLevel?: string }
type AnthropicThinkingConfig = NonNullable<MessageCreateParams['thinking']>

function isAnthropicAdapter(adapterId: string): boolean {
  return adapterId === 'anthropic' || adapterId === 'azure-anthropic' || adapterId === 'google-vertex-anthropic'
}

function isGeminiAdapter(adapterId: string): boolean {
  return adapterId === 'google' || adapterId === 'google-vertex'
}

function isMultiplexedGatewayAdapter(adapterId: string): boolean {
  return adapterId === 'cherryin' || adapterId === 'newapi' || adapterId === 'aihubmix' || adapterId === 'gateway'
}

function targetsAnthropic(adapterId: string, provider: Provider, model: Model): boolean {
  return (
    isAnthropicAdapter(adapterId) ||
    (isMultiplexedGatewayAdapter(adapterId) &&
      resolveEffectiveEndpoint(provider, model).endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
  )
}

function targetsGemini(adapterId: string, provider: Provider, model: Model): boolean {
  return (
    isGeminiAdapter(adapterId) ||
    (isMultiplexedGatewayAdapter(adapterId) &&
      resolveEffectiveEndpoint(provider, model).endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
  )
}

function buildMultiplexedGatewayOptions(provider: Provider, model: Model, assistant: Assistant): ProviderOptions {
  switch (resolveEffectiveEndpoint(provider, model).endpointType) {
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return { anthropic: getAnthropicReasoningParams(assistant, model) } as ProviderOptions
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return { google: getGeminiReasoningParams(assistant, model) } as ProviderOptions
    case ENDPOINT_TYPE.OPENAI_RESPONSES:
      return { openai: getOpenAIReasoningParams(assistant, model) } as ProviderOptions
    default:
      return { 'openai-compatible': getReasoningEffort(assistant, model, provider) } as ProviderOptions
  }
}

function buildProviderOptions(provider: Provider, model: Model, effort: GatewayReasoningEffort): ProviderOptions {
  const assistant = { settings: { reasoning_effort: effort } } as Assistant
  const adapterId = getAiSdkProviderId(provider, model)

  switch (adapterId) {
    case 'openai':
    case 'openai-chat':
    case 'azure':
    case 'azure-responses':
    case 'huggingface':
      return { openai: getOpenAIReasoningParams(assistant, model) } as ProviderOptions
    case 'anthropic':
    case 'azure-anthropic':
    case 'google-vertex-anthropic':
      return { anthropic: getAnthropicReasoningParams(assistant, model) } as ProviderOptions
    case 'google':
    case 'google-vertex':
      return { google: getGeminiReasoningParams(assistant, model) } as ProviderOptions
    case 'xai':
    case 'xai-responses':
      return { xai: getXAIReasoningParams(assistant, model) } as ProviderOptions
    case 'bedrock':
      return { bedrock: getBedrockReasoningParams(assistant, model) } as ProviderOptions
    case 'ollama':
      return { ollama: getOllamaReasoningParams(assistant, model) } as ProviderOptions
    case 'cherryin':
    case 'newapi':
    case 'aihubmix':
    case 'gateway':
      return buildMultiplexedGatewayOptions(provider, model, assistant)
    default:
      return { [adapterId]: getReasoningEffort(assistant, model, provider) } as ProviderOptions
  }
}

/** Keep an Anthropic-native thinking envelope byte-for-byte equivalent. */
function passThroughAnthropicThinking(config: AnthropicThinkingConfig): ProviderOptions {
  return {
    anthropic: {
      thinking:
        config.type === 'enabled' ? { type: 'enabled', budgetTokens: config.budget_tokens } : { type: config.type }
    }
  } as ProviderOptions
}

/** Keep Gemini sentinels and optional fields exactly as supplied. */
function passThroughGeminiThinking(thinkingConfig: GeminiThinkingConfig): ProviderOptions | undefined {
  const { includeThoughts, thinkingBudget, thinkingLevel } = thinkingConfig
  const nativeThinkingConfig: GeminiThinkingConfig = {}
  if (typeof thinkingBudget === 'number') nativeThinkingConfig.thinkingBudget = thinkingBudget
  if (typeof includeThoughts === 'boolean') nativeThinkingConfig.includeThoughts = includeThoughts
  if (typeof thinkingLevel === 'string') nativeThinkingConfig.thinkingLevel = thinkingLevel
  if (Object.keys(nativeThinkingConfig).length === 0) return undefined
  return { google: { thinkingConfig: nativeThinkingConfig } } as ProviderOptions
}

/** Map an Anthropic thinking configuration to the resolved model's target dialect. */
export function mapAnthropicThinkingToProviderOptions(
  provider: Provider,
  model: Model,
  config: MessageCreateParams['thinking']
): ProviderOptions | undefined {
  if (!config) return undefined

  const adapterId = getAiSdkProviderId(provider, model)
  if (targetsAnthropic(adapterId, provider, model)) return passThroughAnthropicThinking(config)

  if (config.type === 'disabled') return buildProviderOptions(provider, model, 'none')
  if (config.type !== 'enabled') return buildProviderOptions(provider, model, 'auto')

  const effort = nearestEffortForBudget(config.budget_tokens, model.reasoning?.thinkingTokenLimits) ?? 'high'
  return buildProviderOptions(provider, model, effort)
}

/** Map a Gemini-native thinking configuration to the resolved model's target dialect. */
export function mapGeminiThinkingToProviderOptions(
  provider: Provider,
  model: Model,
  thinkingConfig: GeminiThinkingConfig
): ProviderOptions | undefined {
  const adapterId = getAiSdkProviderId(provider, model)
  if (targetsGemini(adapterId, provider, model)) return passThroughGeminiThinking(thinkingConfig)

  const { includeThoughts, thinkingBudget, thinkingLevel } = thinkingConfig
  let effort: GatewayReasoningEffort | undefined
  if (typeof thinkingLevel === 'string') effort = thinkingLevel
  else if (thinkingBudget === -1) effort = 'auto'
  else if (thinkingBudget === 0) effort = 'none'
  else if (typeof thinkingBudget === 'number' && thinkingBudget > 0) {
    effort = nearestEffortForBudget(thinkingBudget, model.reasoning?.thinkingTokenLimits) ?? 'high'
  } else if (includeThoughts === true) effort = 'auto'
  else if (includeThoughts === false) effort = 'none'

  return effort === undefined ? undefined : buildProviderOptions(provider, model, effort)
}

/** Map OpenAI-style reasoning_effort to the resolved model's target dialect. */
export function mapReasoningEffortToProviderOptions(
  provider: Provider,
  model: Model,
  reasoningEffort?: ReasoningEffort
): ProviderOptions | undefined {
  return reasoningEffort == null ? undefined : buildProviderOptions(provider, model, reasoningEffort)
}
