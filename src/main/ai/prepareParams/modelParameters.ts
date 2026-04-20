/**
 * Model-parameter resolution helpers.
 *
 * Translate Assistant settings + Model/Provider capabilities into the final
 * `temperature` / `topP` / `maxOutputTokens` values that are sent to the AI
 * SDK. Ported from renderer `aiCore/prepareParams/modelParameters.ts` and
 * adapted to the v2 shared types — callers supply the resolved `Provider`
 * explicitly instead of going through the renderer's Redux-backed lookup.
 */

import { loggerService } from '@logger'
import { DEFAULT_TIMEOUT } from '@shared/config/constant'
import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import {
  isClaude46SeriesModel,
  isClaudeReasoningModel,
  isMaxTemperatureOneModel,
  isSupportedFlexServiceTier,
  isSupportedThinkingTokenClaudeModel,
  isSupportTemperatureModel,
  isSupportTopPModel,
  isTemperatureTopPMutuallyExclusiveModel
} from '@shared/utils/model'
import { isAwsBedrockProvider } from '@shared/utils/provider'

import { getThinkingBudget } from '../utils/reasoning'

const logger = loggerService.withContext('modelParameters')

/**
 * Resolve the `temperature` value to send with the request, or `undefined`
 * to fall back to the provider default.
 *
 *   - Disabled when `enableTemperature` is off.
 *   - Disabled for Claude reasoning models when reasoning effort is set
 *     (other than `default` / `none`) — thinking is incompatible with
 *     temperature modifications.
 *   - Disabled for models that do not support temperature at all.
 *   - Clamped to 1 on models with a max temperature of 1.
 */
export function getTemperature(assistant: Assistant, model: Model): number | undefined {
  const enableTemperature = assistant.settings?.enableTemperature ?? DEFAULT_ASSISTANT_SETTINGS.enableTemperature
  if (!enableTemperature) return undefined

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

/**
 * Resolve the `topP` value to send, or `undefined` to use the provider default.
 *
 *   - Disabled when `enableTopP` is off.
 *   - Disabled for models that don't support topP.
 *   - Disabled on mutually-exclusive models when temperature is also enabled
 *     (temperature wins).
 *   - Clamped to `[0.95, 1]` on Claude reasoning models when reasoning effort
 *     is set (other than `default` / `none`).
 */
export function getTopP(assistant: Assistant, model: Model): number | undefined {
  const enableTopP = assistant.settings?.enableTopP ?? DEFAULT_ASSISTANT_SETTINGS.enableTopP
  if (!enableTopP) return undefined

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

/** Provider timeout override (`flex` tier gets a longer timeout). */
export function getTimeout(model: Model): number {
  if (isSupportedFlexServiceTier(model)) return 15 * 1000 * 60
  return DEFAULT_TIMEOUT
}

/**
 * Resolve the `maxOutputTokens` value to send, or `undefined` to let the
 * provider pick its default. For Claude thinking-token models (pre-4.6),
 * subtracts the thinking budget because the AI SDK adds it back on top.
 */
export function getMaxTokens(assistant: Assistant, model: Model, provider: Provider): number | undefined {
  const enableMaxTokens = assistant.settings?.enableMaxTokens ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxTokens
  let maxTokens = assistant.settings?.maxTokens ?? DEFAULT_ASSISTANT_SETTINGS.maxTokens

  if (!enableMaxTokens || maxTokens === undefined) return undefined

  // Claude 4.6 uses adaptive thinking (no budgetTokens), so the AI SDK does
  // not add budget back to maxOutputTokens — skip the subtraction.
  const isAnthropicLike =
    provider.id === 'anthropic' || provider.presetProviderId === 'anthropic' || isAwsBedrockProvider(provider)
  if (isSupportedThinkingTokenClaudeModel(model) && !isClaude46SeriesModel(model) && isAnthropicLike) {
    const reasoningEffort = assistant.settings?.reasoning_effort
    const budget = getThinkingBudget(maxTokens, reasoningEffort, model.id)
    if (budget) maxTokens -= budget
  }

  return maxTokens
}
