import type { EndpointType } from '../schemas/enums'
import { getModelRequestPolicies } from './requestPolicyLookup'

export interface SamplingContext {
  modelId: string
  providerId?: string
  endpointType?: EndpointType
  reasoning?: 'default' | 'off' | 'on'
  parameterSupport?: {
    temperature?: { supported: boolean; max?: number }
    topP?: { supported: boolean }
    topK?: { supported: boolean }
  }
}

export interface SamplingPolicy {
  omitTemperature: boolean
  omitTopP: boolean
  omitTopK: boolean
  omitCachedContent: boolean
  temperatureMax?: number
  topPMin?: number
  exclusiveTemperatureTopP: boolean
}

/** Read parameterSupport; model names never imply parameter constraints at request time. */
export function getSamplingPolicy(context: SamplingContext): SamplingPolicy {
  const catalog = getModelRequestPolicies(context.modelId, context.providerId)?.parameterSupport
  const temperature = { ...catalog?.temperature, ...context.parameterSupport?.temperature }
  const topP = { ...catalog?.topP, ...context.parameterSupport?.topP }
  const topK = context.parameterSupport?.topK ?? catalog?.topK
  const active = context.reasoning === 'on'
  const off = context.reasoning === 'off'
  return {
    omitTemperature:
      temperature.supported === false ||
      (temperature.requiresExplicitReasoningOff === true && !off) ||
      (active && temperature.whenReasoning?.supported === false),
    omitTopP:
      topP.supported === false ||
      (topP.requiresExplicitReasoningOff === true && !off) ||
      (active && topP.whenReasoning?.supported === false),
    omitTopK: topK?.supported === false,
    omitCachedContent: catalog?.cachedContent === false,
    temperatureMax:
      temperature.max ?? (active ? temperature.whenReasoning?.range?.max : undefined) ?? temperature.range?.max,
    topPMin: active ? topP.whenReasoning?.range?.min : undefined,
    exclusiveTemperatureTopP: topP.exclusiveWithTemperature === true
  }
}
