/**
 * 模型基础参数处理模块
 * 处理温度、TopP、超时等基础参数的获取逻辑
 */

import { loggerService } from '@logger'
import {
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
import { DEFAULT_TIMEOUT } from '@shared/config/constant'

import { getThinkingBudget } from '../utils/reasoning'

const logger = loggerService.withContext('modelParameters')

/**
 * Retrieves the temperature parameter, adapting it based on assistant.settings and model capabilities.
 * - Disabled when enableTemperature is off.
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

  if (isMaxTemperatureOneModel(model)) {
    logger.info(`Model ${model.id} has max temperature of 1, clamping temperature to 1`)
    temperature = Math.min(1, temperature)
  }

  // Use temperature if topP is enabled and model only accepts one of the two
  if (isTemperatureTopPMutuallyExclusiveModel(model) && assistant.settings?.enableTopP) {
    logger.info(`Model ${model.id} only accepts one of temperature and topP, using temperature instead`)
  }

  return temperature
}

/**
 * Retrieves the TopP parameter, adapting it based on assistant.settings and model capabilities.
 * - Disabled when enableTopP is off.
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

  if (!isSupportTopPModel(model, assistant)) {
    logger.info(`Model ${model.id} does not support topP, disabling topP.`)
    return undefined
  }

  if (isTemperatureTopPMutuallyExclusiveModel(model) && assistant.settings?.enableTemperature) {
    logger.info(`Model ${model.id} only accepts one of temperature and top, disabling topP.`)
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
    logger.info(`Claude Model ${model.id} has reasoning enabled, clamping topP to [0.95, 1]`)
    topP = Math.max(0.95, Math.min(topP, 1))
  }

  return topP
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
  if (isSupportedThinkingTokenClaudeModel(model) && ['anthropic', 'aws-bedrock'].includes(provider.type)) {
    const { reasoning_effort: reasoningEffort } = assistantSettings
    const budget = getThinkingBudget(maxTokens, reasoningEffort, model.id)
    if (budget) {
      maxTokens -= budget
    }
  }
  return maxTokens
}
