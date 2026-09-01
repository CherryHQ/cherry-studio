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
import { projectRuntimeReasoning, providerRegistryService } from '@data/services/ProviderRegistryService'
import {
  resolveAiSdkProviderId,
  resolveEffectiveEndpoint,
  resolveEndpointProviderOptionsKey
} from '@main/ai/provider/endpoint'
import { buildResolvedReasoningProviderOptions } from '@main/ai/utils/options'
import { resolveReasoningInvocation } from '@main/ai/utils/reasoningSerializers'
import { nearestEffortForBudget } from '@shared/ai/reasoning'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { type ReasoningEffortOption, ReasoningEffortOptionSchema } from '@shared/types/aiSdk'

// Re-export for use by message converters.
export type { ReasoningEffort }

type GatewayReasoningEffort = ReasoningEffortOption
type GeminiThinkingConfig = { includeThoughts?: boolean; thinkingBudget?: number; thinkingLevel?: string }
type AnthropicThinkingConfig = NonNullable<MessageCreateParams['thinking']>

function resolveProviderReasoningContext(
  provider: Provider,
  model: Model,
  resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
) {
  const { endpointType } = resolvedEndpoint
  const reasoningProfile = providerRegistryService.resolveReasoningProfile(provider, model, endpointType)
  return {
    aiSdkProviderId: resolveAiSdkProviderId(provider, endpointType),
    endpointType,
    invocationModel: reasoningProfile.support
      ? { ...model, reasoning: projectRuntimeReasoning(reasoningProfile.support, reasoningProfile.wire) }
      : model,
    providerOptionsKey: resolveEndpointProviderOptionsKey(provider, resolvedEndpoint),
    reasoningProfile
  }
}

type ProviderReasoningContext = ReturnType<typeof resolveProviderReasoningContext>

function buildProviderOptions(
  context: ProviderReasoningContext,
  effort: GatewayReasoningEffort,
  maxTokens?: number
): ProviderOptions {
  const reasoning = resolveReasoningInvocation({
    selection: effort,
    model: context.invocationModel,
    profile: context.reasoningProfile.wire,
    maxTokens
  })
  return buildResolvedReasoningProviderOptions({
    aiSdkProviderId: context.aiSdkProviderId,
    providerOptionsKey: context.providerOptionsKey,
    endpointType: context.endpointType,
    reasoning
  }) as ProviderOptions
}

/** Keep Anthropic-native thinking and effort fields byte-for-byte equivalent. */
function passThroughAnthropicReasoning(
  config: AnthropicThinkingConfig | undefined,
  effort: GatewayReasoningEffort | null | undefined
): ProviderOptions | undefined {
  if (!config && effort == null) return undefined
  return {
    anthropic: {
      ...(config
        ? {
            thinking:
              config.type === 'enabled'
                ? { type: 'enabled', budgetTokens: config.budget_tokens }
                : { type: config.type }
          }
        : {}),
      ...(effort != null ? { effort } : {})
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
  config: MessageCreateParams['thinking'],
  effort?: GatewayReasoningEffort | null,
  maxTokens?: number
): ProviderOptions | undefined {
  const resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
  const { endpointType } = resolvedEndpoint
  if (endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) {
    return passThroughAnthropicReasoning(config, effort)
  }
  // Ollama's ChatHandler 400s when `think` is true for a model that lacks
  // thinking capability. The SDK default ({type:'adaptive'}) would map to
  // think:true, breaking agent mode for non-thinking models. Only emit think
  // when the user explicitly enabled thinking or set a reasoning effort.
  if (endpointType === ENDPOINT_TYPE.OLLAMA_CHAT) {
    if (config?.type !== 'disabled' && effort == null && config?.type !== 'enabled') return undefined
    const context = resolveProviderReasoningContext(provider, model, resolvedEndpoint)
    if (config?.type === 'disabled') return buildProviderOptions(context, 'none', maxTokens)
    if (effort != null) return buildProviderOptions(context, effort, maxTokens)
    if (config?.type === 'enabled') {
      const budgetEffort =
        nearestEffortForBudget(config.budget_tokens, context.invocationModel.reasoning?.thinkingTokenLimits) ?? 'high'
      return buildProviderOptions(context, budgetEffort, maxTokens)
    }
    return undefined
  }

  if (effort != null) {
    return buildProviderOptions(resolveProviderReasoningContext(provider, model, resolvedEndpoint), effort, maxTokens)
  }
  if (!config) return undefined
  const context = resolveProviderReasoningContext(provider, model, resolvedEndpoint)
  if (config.type === 'disabled') return buildProviderOptions(context, 'none', maxTokens)
  if (config.type !== 'enabled') return buildProviderOptions(context, 'auto', maxTokens)

  const budgetEffort =
    nearestEffortForBudget(config.budget_tokens, context.invocationModel.reasoning?.thinkingTokenLimits) ?? 'high'
  return buildProviderOptions(context, budgetEffort, maxTokens)
}

/** Map a Gemini-native thinking configuration to the resolved model's target dialect. */
export function mapGeminiThinkingToProviderOptions(
  provider: Provider,
  model: Model,
  thinkingConfig: GeminiThinkingConfig,
  maxTokens?: number
): ProviderOptions | undefined {
  const resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
  const { endpointType } = resolvedEndpoint
  if (endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) return passThroughGeminiThinking(thinkingConfig)

  const { includeThoughts, thinkingBudget, thinkingLevel } = thinkingConfig
  let effort: GatewayReasoningEffort | undefined
  let context: ProviderReasoningContext | undefined
  if (thinkingLevel !== undefined) {
    const parsed = ReasoningEffortOptionSchema.safeParse(thinkingLevel)
    if (parsed.success) effort = parsed.data
  } else if (thinkingBudget === -1) effort = 'auto'
  else if (thinkingBudget === 0) effort = 'none'
  else if (typeof thinkingBudget === 'number' && thinkingBudget > 0) {
    context = resolveProviderReasoningContext(provider, model, resolvedEndpoint)
    effort = nearestEffortForBudget(thinkingBudget, context.invocationModel.reasoning?.thinkingTokenLimits) ?? 'high'
  } else if (includeThoughts === true) effort = 'auto'
  else if (includeThoughts === false) effort = 'none'

  if (effort === undefined) return undefined
  return buildProviderOptions(
    context ?? resolveProviderReasoningContext(provider, model, resolvedEndpoint),
    effort,
    maxTokens
  )
}

/** Map OpenAI-style reasoning_effort to the resolved model's target dialect. */
export function mapReasoningEffortToProviderOptions(
  provider: Provider,
  model: Model,
  reasoningEffort?: ReasoningEffort,
  maxTokens?: number
): ProviderOptions | undefined {
  return reasoningEffort == null
    ? undefined
    : buildProviderOptions(resolveProviderReasoningContext(provider, model), reasoningEffort, maxTokens)
}
