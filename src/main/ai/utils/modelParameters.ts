/** Sampling policy is resolved by the registry; this module applies it to request values. */
import type { ProviderOptions } from '@ai-sdk/provider-utils'

import { getSamplingPolicy, type SamplingContext } from '@cherrystudio/provider-registry'
import type { SamplingSettings } from '@main/ai/types'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { AiSdkParam } from '@shared/types/aiSdk'
import { getRawModelId } from '@shared/utils/model'

import type { ResolvedReasoningInvocation } from './reasoningSerializers'

export type GatedSampling = Pick<SamplingSettings, 'temperature' | 'enableTemperature' | 'topP' | 'enableTopP'>
type SamplingReasoning = Pick<ResolvedReasoningInvocation, 'kind'>
type SamplingParams = {
  standardParams: Record<string, unknown>
  providerOptions: ProviderOptions
  bodyParams: Record<string, unknown>
}

function samplingContext(model: Model, reasoning?: SamplingReasoning): SamplingContext {
  return {
    modelId: getRawModelId(model),
    providerId: model.providerId,
    parameterSupport: model.parameterSupport,
    reasoning: !reasoning || reasoning.kind === 'omit' ? 'default' : reasoning.kind === 'off' ? 'off' : 'on'
  }
}

/** Read the effective wire settings after custom/body overrides, scoped to the active adapter. */
export function resolveSamplingReasoning(
  params: Pick<SamplingParams, 'providerOptions' | 'bodyParams'>,
  context: { reasoning?: SamplingReasoning; providerOptionsKey?: string }
): SamplingReasoning {
  const options = context.providerOptionsKey ? params.providerOptions[context.providerOptionsKey] : undefined
  const member = (value: unknown, key: string): unknown =>
    value && typeof value === 'object' && key in value ? (value as Record<string, unknown>)[key] : undefined
  const effort =
    params.bodyParams.reasoning_effort ??
    member(params.bodyParams.reasoning, 'effort') ??
    options?.reasoningEffort ??
    options?.reasoning_effort ??
    member(options?.reasoning, 'effort')
  if (typeof effort === 'string') return { kind: effort === 'none' ? 'off' : 'effort' }
  const thinking = params.bodyParams.thinking ?? options?.thinking
  const type = member(thinking, 'type')
  if (type === 'disabled') return { kind: 'off' }
  if (type === 'enabled' || type === 'adaptive' || type === 'auto') return { kind: 'auto' }
  return context.reasoning ?? { kind: 'omit' }
}

/** Omit rejected sampling after all overrides, including passthrough body values. */
export function stripRejectedSamplingParams(
  params: SamplingParams,
  model: Model,
  context: { reasoning?: SamplingReasoning; providerOptionsKey?: string; endpointType?: EndpointType } = {}
): SamplingParams {
  const input = samplingContext(model, resolveSamplingReasoning(params, context))
  const policy = getSamplingPolicy({ ...input, endpointType: context.endpointType })
  if (!policy.omitTemperature && !policy.omitTopP && !policy.omitTopK) return params

  function strip<T>(values: Record<string, T>): Record<string, T> {
    const cleaned = { ...values }
    if (policy.omitTemperature) delete cleaned.temperature
    if (policy.omitTopP) {
      delete cleaned.topP
      delete cleaned.top_p
    }
    if (policy.omitTopK) {
      delete cleaned.topK
      delete cleaned.top_k
    }
    return cleaned
  }
  return {
    standardParams: strip(params.standardParams),
    providerOptions: Object.fromEntries(
      Object.entries(params.providerOptions).map(([key, options]) => [key, strip(options)])
    ),
    bodyParams: strip(params.bodyParams)
  }
}

/** `undefined` leaves the provider default in effect. */
export function getTemperature(
  settings: GatedSampling,
  model: Model,
  reasoning: SamplingReasoning
): number | undefined {
  const policy = getSamplingPolicy(samplingContext(model, reasoning))
  if (!settings.enableTemperature || policy.omitTemperature) return undefined
  return policy.temperatureMax === undefined
    ? settings.temperature
    : Math.min(settings.temperature, policy.temperatureMax)
}

/** Temperature wins when both settings are enabled on mutually-exclusive models. */
export function getTopP(settings: GatedSampling, model: Model, reasoning: SamplingReasoning): number | undefined {
  const policy = getSamplingPolicy(samplingContext(model, reasoning))
  if (!settings.enableTopP || policy.omitTopP || (policy.exclusiveTemperatureTopP && settings.enableTemperature))
    return undefined
  return policy.topPMin === undefined ? settings.topP : Math.max(policy.topPMin, Math.min(settings.topP, 1))
}

export function filterStandardParams(
  standardParams: Partial<Record<AiSdkParam, any>>,
  model: Model
): Partial<Record<AiSdkParam, any>> {
  if (!getSamplingPolicy(samplingContext(model)).omitTopK || !('topK' in standardParams)) return standardParams
  const filtered = { ...standardParams }
  delete filtered.topK
  return filtered
}

/**
 * Anthropic Messages providers add the explicit thinking budget on top of
 * `maxOutputTokens`. Cherry Studio's limit is the total generated-token cap,
 * so pass the non-thinking remainder to the SDK. Adaptive thinking has no
 * explicit budget and therefore needs no adjustment.
 */
export function adjustMaxOutputTokensForReasoning(
  maxOutputTokens: number | undefined,
  endpointType: EndpointType | undefined,
  reasoning: Pick<ResolvedReasoningInvocation, 'budgetTokens'>
): number | undefined {
  if (maxOutputTokens === undefined || endpointType !== ENDPOINT_TYPE.ANTHROPIC_MESSAGES) {
    return maxOutputTokens
  }

  const budget = reasoning.budgetTokens
  return budget ? Math.max(1, maxOutputTokens - budget) : maxOutputTokens
}
