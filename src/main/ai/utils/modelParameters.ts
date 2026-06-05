/**
 * Assistant + Model/Provider capabilities → final `temperature` / `topP`
 * / `maxOutputTokens`.
 */

import { loggerService } from '@logger'
import { DEFAULT_TIMEOUT } from '@shared/config/constant'
import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { AiSdkParam } from '@shared/types/aiSdk'
import {
  isClaude46SeriesModel,
  isClaude47SeriesModel,
  isClaudeReasoningModel,
  isGemini3Model,
  isMaxTemperatureOneModel,
  isSupportedFlexServiceTier,
  isSupportedThinkingTokenClaudeModel,
  isSupportTemperatureModel,
  isSupportTopPModel,
  isTemperatureTopPMutuallyExclusiveModel
} from '@shared/utils/model'
import { isAwsBedrockProvider } from '@shared/utils/provider'

import { getThinkingBudget } from './reasoning'

const logger = loggerService.withContext('modelParameters')

/** `undefined` falls back to the provider default. */
export function getTemperature(assistant: Assistant, model: Model): number | undefined {
  if (isGemini3Model(model)) {
    logger.info(`Gemini 3.x model ${model.id} uses default sampling settings, disabling temperature`)
    return undefined
  }

  const enableTemperature = assistant.settings?.enableTemperature ?? DEFAULT_ASSISTANT_SETTINGS.enableTemperature
  if (!enableTemperature) return undefined

  if (isClaude47SeriesModel(model)) {
    logger.info(`Model ${model.id} rejects sampling parameters, disabling temperature`)
    return undefined
  }

  if (
    isClaudeReasoningModel(model) &&
    assistant.settings?.reasoning_effort &&
    assistant.settings.reasoning_effort !== 'default' &&
    assistant.settings.reasoning_effort !== 'none'
  ) {
    logger.info(`Model ${model.id} does not support reasoning with temperature, disabling temperature`)
    return undefined
  }

  if (!isSupportTemperatureModel(model)) {
    logger.info(`Model ${model.id} does not support temperature, disabling temperature`)
    return undefined
  }

  let temperature = assistant.settings?.temperature ?? DEFAULT_ASSISTANT_SETTINGS.temperature

  if (isMaxTemperatureOneModel(model) && temperature > 1) {
    logger.info(`Model ${model.id} has max temperature of 1, clamping temperature from ${temperature} to 1`)
    temperature = 1
  }

  if (isTemperatureTopPMutuallyExclusiveModel(model) && assistant.settings?.enableTopP) {
    logger.info(`Model ${model.id} only accepts one of temperature and topP, both enabled; keeping temperature`)
  }

  return temperature
}

/** Temperature wins when both are enabled on mutually-exclusive models. */
export function getTopP(assistant: Assistant, model: Model): number | undefined {
  if (isGemini3Model(model)) {
    logger.info(`Gemini 3.x model ${model.id} uses default sampling settings, disabling topP`)
    return undefined
  }

  const enableTopP = assistant.settings?.enableTopP ?? DEFAULT_ASSISTANT_SETTINGS.enableTopP
  if (!enableTopP) return undefined

  if (isClaude47SeriesModel(model)) {
    logger.info(`Model ${model.id} rejects sampling parameters, disabling topP`)
    return undefined
  }

  if (!isSupportTopPModel(model)) {
    logger.info(`Model ${model.id} does not support topP, disabling topP.`)
    return undefined
  }

  if (isTemperatureTopPMutuallyExclusiveModel(model) && assistant.settings?.enableTemperature) {
    logger.info(`Model ${model.id} only accepts one of temperature and topP, disabling topP.`)
    return undefined
  }

  let topP = assistant.settings?.topP ?? DEFAULT_ASSISTANT_SETTINGS.topP

  if (
    isClaudeReasoningModel(model) &&
    assistant.settings?.reasoning_effort &&
    assistant.settings.reasoning_effort !== 'default' &&
    assistant.settings.reasoning_effort !== 'none'
  ) {
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

/** For Claude thinking-token models (pre-4.6) the AI SDK adds the budget on top, so subtract. */
export function getMaxTokens(assistant: Assistant, model: Model, provider: Provider): number | undefined {
  const enableMaxTokens = assistant.settings?.enableMaxTokens ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxTokens
  let maxTokens = assistant.settings?.maxTokens ?? DEFAULT_ASSISTANT_SETTINGS.maxTokens

  if (!enableMaxTokens || maxTokens === undefined) return undefined

  // Claude 4.6 adaptive thinking has no budgetTokens, so no subtraction.
  const isAnthropicLike =
    provider.id === 'anthropic' || provider.presetProviderId === 'anthropic' || isAwsBedrockProvider(provider)
  if (
    isSupportedThinkingTokenClaudeModel(model) &&
    !isClaude46SeriesModel(model) &&
    !isClaude47SeriesModel(model) &&
    isAnthropicLike
  ) {
    const reasoningEffort = assistant.settings?.reasoning_effort
    const budget = getThinkingBudget(maxTokens, reasoningEffort, model.id)
    if (budget) maxTokens -= budget
  }

  return maxTokens
}
