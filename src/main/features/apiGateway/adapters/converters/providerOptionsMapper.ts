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
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { resolveAiSdkProviderId, resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
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

function buildProviderOptions(provider: Provider, model: Model, effort: GatewayReasoningEffort): ProviderOptions {
  const { endpointType } = resolveEffectiveEndpoint(provider, model)
  const aiSdkProviderId = resolveAiSdkProviderId(provider, endpointType)
  const reasoningProfile = providerRegistryService.resolveReasoningProfile(provider, model, endpointType)
  const reasoning = resolveReasoningInvocation({
    selection: effort,
    model,
    profile: reasoningProfile.wire,
    assistantSummary: provider.settings?.summaryText
  })
  return buildResolvedReasoningProviderOptions({
    aiSdkProviderId,
    endpointType,
    reasoning,
    actualProviderId: provider.id
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
  effort?: GatewayReasoningEffort | null
): ProviderOptions | undefined {
  const { endpointType } = resolveEffectiveEndpoint(provider, model)
  if (endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) {
    return passThroughAnthropicReasoning(config, effort)
  }

  if (effort != null) return buildProviderOptions(provider, model, effort)
  if (!config) return undefined
  if (config.type === 'disabled') return buildProviderOptions(provider, model, 'none')
  if (config.type !== 'enabled') return buildProviderOptions(provider, model, 'auto')

  const budgetEffort = nearestEffortForBudget(config.budget_tokens, model.reasoning?.thinkingTokenLimits) ?? 'high'
  return buildProviderOptions(provider, model, budgetEffort)
}

/** Map a Gemini-native thinking configuration to the resolved model's target dialect. */
export function mapGeminiThinkingToProviderOptions(
  provider: Provider,
  model: Model,
  thinkingConfig: GeminiThinkingConfig
): ProviderOptions | undefined {
  const { endpointType } = resolveEffectiveEndpoint(provider, model)
  if (endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) return passThroughGeminiThinking(thinkingConfig)

  const { includeThoughts, thinkingBudget, thinkingLevel } = thinkingConfig
  let effort: GatewayReasoningEffort | undefined
  if (thinkingLevel !== undefined) {
    const parsed = ReasoningEffortOptionSchema.safeParse(thinkingLevel)
    if (parsed.success) effort = parsed.data
  } else if (thinkingBudget === -1) effort = 'auto'
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
