/**
 * Sampling settings + Model/Provider capabilities → final `temperature` / `topP`
 * / `maxOutputTokens`. The settings come from an assistant, or from a feature
 * that keeps its own (translate).
 */

import { loggerService } from '@logger'
import { DEFAULT_TIMEOUT } from '@main/ai/constants'
import type { SamplingSettings } from '@main/ai/types'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { AiSdkParam } from '@shared/types/aiSdk'
import {
  isClaude47SeriesModel,
  isClaudeReasoningModel,
  isGemini3Model,
  isMaxTemperatureOneModel,
  isSupportedFlexServiceTier,
  isSupportTemperatureModel,
  isSupportTopPModel,
  isTemperatureTopPMutuallyExclusiveModel
} from '@shared/utils/model'

import type { ResolvedReasoningInvocation } from './reasoningSerializers'

const logger = loggerService.withContext('modelParameters')

/** The two sampling fields these gates read; `maxTokens` has no gate of its own. */
export type GatedSampling = Pick<SamplingSettings, 'temperature' | 'enableTemperature' | 'topP' | 'enableTopP'>

/**
 * Whether the model accepts this sampling parameter on the wire at all — false means any
 * explicit value (from assistant settings, custom parameters, or gateway overrides) gets a
 * provider-side 400: the fixed-sampling families (Gemini 3.x / Claude 4.7) and registry
 * `parameterSupport: supported: false` declarations both lock sampling server-side.
 */
export function modelAcceptsSamplingParam(model: Model, key: 'temperature' | 'topP'): boolean {
  if (isGemini3Model(model) || isClaude47SeriesModel(model)) return false
  return key === 'temperature' ? isSupportTemperatureModel(model) : isSupportTopPModel(model)
}

/**
 * Terminal sampling sanitize — the single choke point at the request's final surfaces.
 * Whatever injected the values (assistant settings, custom parameters flat or namespaced,
 * gateway overrides), strip the sampling keys the model rejects from the standard params
 * and every providerOptions namespace before they reach the wire.
 */
export function stripRejectedSamplingParams(
  standardParams: Record<string, any>,
  providerOptions: Record<string, Record<string, any>>,
  model: Model
): { standardParams: Record<string, any>; providerOptions: Record<string, Record<string, any>> } {
  const acceptsTemperature = modelAcceptsSamplingParam(model, 'temperature')
  const acceptsTopP = modelAcceptsSamplingParam(model, 'topP')
  if (acceptsTemperature && acceptsTopP) return { standardParams, providerOptions }

  const nextStandard = { ...standardParams }
  if (!acceptsTemperature && 'temperature' in nextStandard) delete nextStandard.temperature
  if (!acceptsTopP && 'topP' in nextStandard) delete nextStandard.topP

  let nextOptions = providerOptions
  for (const [namespace, options] of Object.entries(providerOptions)) {
    if (!options) continue
    const carriesRejected =
      (!acceptsTemperature && 'temperature' in options) || (!acceptsTopP && ('top_p' in options || 'topP' in options))
    if (!carriesRejected) continue
    const cleaned = { ...options }
    if (!acceptsTemperature) delete cleaned.temperature
    if (!acceptsTopP) {
      delete cleaned.top_p
      delete cleaned.topP
    }
    nextOptions = { ...nextOptions, [namespace]: cleaned }
  }
  return { standardParams: nextStandard, providerOptions: nextOptions }
}

/** `undefined` falls back to the provider default. */
export function getTemperature(
  settings: GatedSampling,
  model: Model,
  reasoning: Pick<ResolvedReasoningInvocation, 'kind'>
): number | undefined {
  if (isGemini3Model(model)) {
    logger.info(`Gemini 3.x model ${model.id} uses default sampling settings, disabling temperature`)
    return undefined
  }

  if (!settings.enableTemperature) return undefined

  if (isClaude47SeriesModel(model)) {
    logger.info(`Model ${model.id} rejects sampling parameters, disabling temperature`)
    return undefined
  }

  if (isClaudeReasoningModel(model) && reasoning.kind !== 'omit' && reasoning.kind !== 'off') {
    logger.info(`Model ${model.id} does not support reasoning with temperature, disabling temperature`)
    return undefined
  }

  if (!isSupportTemperatureModel(model)) {
    logger.info(`Model ${model.id} does not support temperature, disabling temperature`)
    return undefined
  }

  let temperature = settings.temperature

  if (isMaxTemperatureOneModel(model) && temperature > 1) {
    logger.info(`Model ${model.id} has max temperature of 1, clamping temperature from ${temperature} to 1`)
    temperature = 1
  }

  if (isTemperatureTopPMutuallyExclusiveModel(model) && settings.enableTopP) {
    logger.info(`Model ${model.id} only accepts one of temperature and topP, both enabled; keeping temperature`)
  }

  return temperature
}

/** Temperature wins when both are enabled on mutually-exclusive models. */
export function getTopP(
  settings: GatedSampling,
  model: Model,
  reasoning: Pick<ResolvedReasoningInvocation, 'kind'>
): number | undefined {
  if (isGemini3Model(model)) {
    logger.info(`Gemini 3.x model ${model.id} uses default sampling settings, disabling topP`)
    return undefined
  }

  if (!settings.enableTopP) return undefined

  if (isClaude47SeriesModel(model)) {
    logger.info(`Model ${model.id} rejects sampling parameters, disabling topP`)
    return undefined
  }

  if (!isSupportTopPModel(model)) {
    logger.info(`Model ${model.id} does not support topP, disabling topP.`)
    return undefined
  }

  if (isTemperatureTopPMutuallyExclusiveModel(model) && settings.enableTemperature) {
    logger.info(`Model ${model.id} only accepts one of temperature and topP, disabling topP.`)
    return undefined
  }

  let topP = settings.topP

  if (isClaudeReasoningModel(model) && reasoning.kind !== 'omit' && reasoning.kind !== 'off') {
    const clampedTopP = Math.max(0.95, Math.min(topP, 1))
    if (clampedTopP !== topP) {
      logger.info(`Claude Model ${model.id} has reasoning enabled, clamping topP from ${topP} to ${clampedTopP}`)
    }
    topP = clampedTopP
  }

  return topP
}

export function filterStandardParams(
  standardParams: Partial<Record<AiSdkParam, any>>,
  model: Model
): Partial<Record<AiSdkParam, any>> {
  if (isGemini3Model(model) && 'topK' in standardParams) {
    const { topK, ...rest } = standardParams
    logger.info(`Gemini 3.x model ${model.id} uses default sampling settings, dropping topK=${topK} from custom params`)
    return rest
  }

  if (isClaude47SeriesModel(model) && 'topK' in standardParams) {
    const { topK, ...rest } = standardParams
    logger.info(`Model ${model.id} rejects sampling parameters, dropping topK=${topK} from custom params`)
    return rest
  }

  return standardParams
}

/** Provider timeout override (`flex` tier gets a longer timeout). */
export function getTimeout(model: Model): number {
  if (isSupportedFlexServiceTier(model)) return 15 * 1000 * 60
  return DEFAULT_TIMEOUT
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
