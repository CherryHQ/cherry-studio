/**
 * 模型基础参数处理模块
 * 处理温度、TopP、超时等基础参数的获取逻辑
 */

import { loggerService } from '@logger'
import {
  isClaude46SeriesModel,
  isClaude47SeriesModel,
  isClaudeReasoningModel,
  isMaxTemperatureOneModel,
  isSupportedFlexServiceTier,
  isSupportedThinkingTokenClaudeModel,
  isSupportTemperatureModel,
  isSupportTopPModel,
  isTemperatureTopPMutuallyExclusiveModel
} from '@renderer/config/models'
import {
  DEFAULT_ASSISTANT_SETTINGS,
  getAssistantSettings,
  getProviderByModel
} from '@renderer/services/AssistantService'
import { type Assistant, type Model } from '@renderer/types'
import type { AiSdkParam } from '@renderer/types/aiCoreTypes'
import { DEFAULT_TIMEOUT } from '@shared/config/constant'

import { getThinkingBudget } from '../utils/reasoning'

const logger = loggerService.withContext('modelParameters')

/**
 * Retrieves the temperature parameter, adapting it based on assistant.settings and model capabilities.
 * - Disabled when enableTemperature is off.
 * - Disabled unconditionally for Claude Opus 4.7 (rejects sampling params with HTTP 400).
 * - Disabled for Claude reasoning models when reasoning effort is set (excluding 'default' and 'none').
 * - Disabled for models that do not support temperature.
 * - Clamped to 1 for models with max temperature of 1.
 * Otherwise, returns the temperature value.
 */
export function getTemperature(assistant: Assistant, model: Model): number | undefined {
  const enableTemperature = assistant.settings?.enableTemperature ?? DEFAULT_ASSISTANT_SETTINGS.enableTemperature
  if (!enableTemperature) {
    return undefined
  }

  // Claude Opus 4.7 rejects sampling params (temperature/top_p/top_k) with HTTP 400
  // regardless of reasoning settings. See Vercel AI SDK PR #14529.
  if (isClaude47SeriesModel(model)) {
    logger.info(`Model ${model.id} rejects sampling parameters, disabling temperature`)
    return undefined
  }

  // Thinking isn't compatible with temperature or top_k modifications as well as forced tool use.
  // See: https://platform.claude.com/docs/en/build-with-claude/extended-thinking#feature-compatibility
  if (
    isClaudeReasoningModel(model) &&
    assistant.settings?.reasoning_effort &&
    assistant.settings.reasoning_effort !== 'default' &&
    assistant.settings.reasoning_effort !== 'none'
  ) {
    logger.info(`Model ${model.id} does not support reasoning with temperature, disabling temperature`)
    return undefined
  }

  if (!isSupportTemperatureModel(model, assistant)) {
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
 * Retrieves the TopP parameter, adapting it based on assistant.settings and model capabilities.
 * - Disabled when enableTopP is off.
 * - Disabled unconditionally for Claude Opus 4.7 (rejects sampling params with HTTP 400).
 * - Disabled for models that do not support TopP.
 * - Disabled for mutually exclusive models when temperature is enabled.
 * - Clamped to [0.95, 1] for Claude reasoning models with reasoning effort set (excluding 'default' and 'none').
 * Otherwise, returns the TopP value.
 */
export function getTopP(assistant: Assistant, model: Model): number | undefined {
  const enableTopP = assistant.settings?.enableTopP ?? DEFAULT_ASSISTANT_SETTINGS.enableTopP
  if (!enableTopP) {
    return undefined
  }

  // Claude Opus 4.7 rejects sampling params unconditionally (see getTemperature).
  if (isClaude47SeriesModel(model)) {
    logger.info(`Model ${model.id} rejects sampling parameters, disabling topP`)
    return undefined
  }

  if (!isSupportTopPModel(model, assistant)) {
    logger.info(`Model ${model.id} does not support topP, disabling topP.`)
    return undefined
  }

  if (isTemperatureTopPMutuallyExclusiveModel(model) && assistant.settings?.enableTemperature) {
    logger.info(`Model ${model.id} only accepts one of temperature and topP, disabling topP.`)
    return undefined
  }

  let topP = assistant.settings?.topP ?? DEFAULT_ASSISTANT_SETTINGS.topP

  // When thinking is enabled, the topP should be between 0.95 and 1
  // See: https://platform.claude.com/docs/en/build-with-claude/extended-thinking#feature-compatibility
  // NOTE: It depends on the behavior that extended thinking defaults to off, so we clamp the topP value also when reasoning is not 'default'
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

/**
 * Filters AI SDK standard parameters extracted from custom parameters, removing any
 * the model rejects. Currently strips `topK` for Claude Opus 4.7 since it rejects
 * sampling params (temperature/top_p/top_k) with HTTP 400. See `getTemperature`.
 */
export function filterStandardParams(
  standardParams: Partial<Record<AiSdkParam, any>>,
  model: Model
): Partial<Record<AiSdkParam, any>> {
  if (isClaude47SeriesModel(model) && 'topK' in standardParams) {
    const { topK: _topK, ...rest } = standardParams
    logger.info(`Model ${model.id} rejects sampling parameters, dropping topK from custom params`)
    return rest
  }
  return standardParams
}

/**
 * 获取超时设置
 */
export function getTimeout(model: Model): number {
  if (isSupportedFlexServiceTier(model)) {
    return 15 * 1000 * 60
  }
  return DEFAULT_TIMEOUT
}

export function getMaxTokens(assistant: Assistant, model: Model): number | undefined {
  // NOTE: ai-sdk会把maxToken和budgetToken加起来
  const assistantSettings = getAssistantSettings(assistant)
  const enabledMaxTokens = assistantSettings.enableMaxTokens ?? false
  let maxTokens = assistantSettings.maxTokens

  // If user hasn't enabled enableMaxTokens, return undefined to let the API use its default value.
  // Note: Anthropic API requires max_tokens, but that's handled by the Anthropic client with a fallback.
  if (!enabledMaxTokens || maxTokens === undefined) {
    return undefined
  }

  const provider = getProviderByModel(model)
  // Claude 4.6 / 4.7 use adaptive thinking and do not send budgetTokens, so the
  // AI SDK does not add budget back to maxOutputTokens. Skip the subtraction to avoid
  // incorrectly reducing max_tokens.
  if (
    isSupportedThinkingTokenClaudeModel(model) &&
    !isClaude46SeriesModel(model) &&
    !isClaude47SeriesModel(model) &&
    ['anthropic', 'aws-bedrock'].includes(provider.type)
  ) {
    const { reasoning_effort: reasoningEffort } = assistantSettings
    const budget = getThinkingBudget(maxTokens, reasoningEffort, model.id)
    if (budget) {
      maxTokens -= budget
    }
  }
  return maxTokens
}
