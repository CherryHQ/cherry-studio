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

/** Emit a native effort only when the resolved wire carries an effort field, projected through the descriptor pipeline. */
function resolveNativeAnthropicEffort(
  context: ProviderReasoningContext,
  effort: GatewayReasoningEffort | null | undefined,
  maxTokens?: number
): GatewayReasoningEffort | undefined {
  if (effort == null || effort === 'default') return undefined
  const invocation = resolveReasoningInvocation({
    selection: effort,
    model: context.invocationModel,
    profile: context.reasoningProfile.wire,
    maxTokens
  })
  const emission = invocation.emissions.find((candidate) => candidate.target === 'effort')
  return typeof emission?.value === 'string' ? (emission.value as GatewayReasoningEffort) : undefined
}

/**
 * Build the Ollama `think` value strictly from the model's reported controls (#18695, #23375):
 * a named level only when the model advertises that level (projected onto its declared
 * vocabulary by the serializer), a boolean when the model advertises the boolean switch, and
 * no `think` field when the accepted values are unknown so Ollama applies its own default.
 */
function buildOllamaThinkingOptions(
  context: ProviderReasoningContext,
  effort: GatewayReasoningEffort,
  maxTokens?: number
): ProviderOptions | undefined {
  const reasoning = context.invocationModel.reasoning
  const controls = reasoning?.controls
  // No declared controls (never discovered) means the accepted values are unknown: omit `think`.
  if (effort === 'default' || controls === undefined) return undefined

  const values = reasoning?.selectableEfforts ?? []
  const tiers = values.filter((value) => value !== 'none' && value !== 'auto')
  const allowsBoolean = controls.some((control) => control.kind === 'toggle') || values.includes('auto')
  const allowsLevels = controls.some((control) => control.kind === 'effort') && tiers.length > 0

  if (effort === 'none') {
    return controls.length > 0 || values.includes('none') ? buildProviderOptions(context, 'none', maxTokens) : undefined
  }
  if (effort === 'auto') {
    if (allowsBoolean) return buildProviderOptions(context, 'auto', maxTokens)
    // Levels-only model: `think: true` may not be accepted, so fall back to the reported default
    // level; without one, omit `think` and let Ollama apply its default.
    const advertisedDefault = tiers.find((tier) => tier === reasoning?.defaultEffort)
    return allowsLevels && advertisedDefault ? buildProviderOptions(context, advertisedDefault, maxTokens) : undefined
  }
  // A requested named level is clamped onto the advertised tiers by the reasoning serializer.
  if (allowsLevels) return buildProviderOptions(context, effort, maxTokens)
  return allowsBoolean ? buildProviderOptions(context, 'auto', maxTokens) : undefined
}

function canPassThroughAnthropicReasoning(
  context: ProviderReasoningContext,
  config: AnthropicThinkingConfig | undefined
): boolean {
  if (context.providerOptionsKey !== 'anthropic' || !config) return context.providerOptionsKey === 'anthropic'

  const matchesThinkingType = (mode: 'off' | 'auto' | 'effort') =>
    context.reasoningProfile.wire[mode]?.operations.some(
      (operation) =>
        operation.target === 'thinking.type' &&
        operation.value.source === 'literal' &&
        operation.value.value === config.type
    ) ?? false

  if (config.type === 'enabled') {
    return (
      matchesThinkingType('effort') &&
      context.reasoningProfile.wire.effort?.operations.some(
        (operation) => operation.target === 'thinking.budgetTokens' && operation.value.source === 'budget'
      ) === true
    )
  }
  return matchesThinkingType('off') || matchesThinkingType('auto') || matchesThinkingType('effort')
}

/** Keep Anthropic-native thinking envelopes byte-for-byte equivalent; effort arrives pre-projected. */
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
  }
}

/** Keep Gemini sentinels and optional fields exactly as supplied. */
function passThroughGeminiThinking(thinkingConfig: GeminiThinkingConfig): ProviderOptions | undefined {
  const { includeThoughts, thinkingBudget, thinkingLevel } = thinkingConfig
  const nativeThinkingConfig: GeminiThinkingConfig = {}
  if (typeof thinkingBudget === 'number') nativeThinkingConfig.thinkingBudget = thinkingBudget
  if (typeof includeThoughts === 'boolean') nativeThinkingConfig.includeThoughts = includeThoughts
  if (typeof thinkingLevel === 'string') nativeThinkingConfig.thinkingLevel = thinkingLevel
  if (Object.keys(nativeThinkingConfig).length === 0) return undefined
  return { google: { thinkingConfig: nativeThinkingConfig } }
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
  let context: ProviderReasoningContext | undefined
  if (endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) {
    context = resolveProviderReasoningContext(provider, model, resolvedEndpoint)
    if (canPassThroughAnthropicReasoning(context, config)) {
      return passThroughAnthropicReasoning(config, resolveNativeAnthropicEffort(context, effort, maxTokens))
    }
  }
  // Ollama's ChatHandler 400s when `think` is true for a model that lacks
  // thinking capability. The SDK default ({type:'adaptive'}) would map to
  // think:true, breaking agent mode for non-thinking models. Only emit think
  // when the user explicitly enabled thinking or set a reasoning effort.
  if (endpointType === ENDPOINT_TYPE.OLLAMA_CHAT) {
    if (config?.type !== 'disabled' && effort == null && config?.type !== 'enabled') return undefined
    const context = resolveProviderReasoningContext(provider, model, resolvedEndpoint)
    if (config?.type === 'disabled') return buildOllamaThinkingOptions(context, 'none', maxTokens)
    if (effort != null) return buildOllamaThinkingOptions(context, effort, maxTokens)
    if (config?.type === 'enabled') {
      const values = context.invocationModel.reasoning?.selectableEfforts ?? []
      if (values.some((value) => value !== 'none' && value !== 'auto')) {
        const budgetEffort =
          nearestEffortForBudget(config.budget_tokens, context.invocationModel.reasoning?.thinkingTokenLimits) ?? 'high'
        return buildOllamaThinkingOptions(context, budgetEffort, maxTokens)
      }
      return buildOllamaThinkingOptions(context, 'auto', maxTokens)
    }
    return undefined
  }

  if (effort != null) {
    return buildProviderOptions(
      context ?? resolveProviderReasoningContext(provider, model, resolvedEndpoint),
      effort,
      maxTokens
    )
  }
  if (!config) return undefined
  context ??= resolveProviderReasoningContext(provider, model, resolvedEndpoint)
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
  const targetContext = context ?? resolveProviderReasoningContext(provider, model, resolvedEndpoint)
  if (endpointType === ENDPOINT_TYPE.OLLAMA_CHAT) {
    return buildOllamaThinkingOptions(targetContext, effort, maxTokens)
  }
  return buildProviderOptions(targetContext, effort, maxTokens)
}

/** Map OpenAI-style reasoning_effort to the resolved model's target dialect. */
export function mapReasoningEffortToProviderOptions(
  provider: Provider,
  model: Model,
  reasoningEffort?: ReasoningEffort,
  maxTokens?: number
): ProviderOptions | undefined {
  if (reasoningEffort == null) return undefined
  const resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
  const context = resolveProviderReasoningContext(provider, model, resolvedEndpoint)
  // A native Ollama target needs the same guard as the Anthropic dialect: a named effort a
  // toggle-only model cannot express still means "think", not silence.
  if (resolvedEndpoint.endpointType === ENDPOINT_TYPE.OLLAMA_CHAT) {
    return buildOllamaThinkingOptions(context, reasoningEffort, maxTokens)
  }
  return buildProviderOptions(context, reasoningEffort, maxTokens)
}
