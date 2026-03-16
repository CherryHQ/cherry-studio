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
 * - Disabled for Claude reasoning models when reasoning effort is set.
 * - Disabled for models that do not support temperature.
 * - Disabled for Claude 4.5 reasoning models when TopP is enabled and temperature is disabled.
 * Otherwise, returns the temperature value if the assistant has temperature enabled.
 */
export function getTemperature(assistant: Assistant, model: Model): number | undefined {
  const enableTemperature = assistant.settings?.enableTemperature ?? DEFAULT_ASSISTANT_SETTINGS.enableTemperature
  if (!enableTemperature) {
    return undefined
  }

  // Thinking isn't compatible with temperature or top_k modifications as well as forced tool use.
  // See: https://platform.claude.com/docs/en/build-with-claude/extended-thinking#feature-compatibility
  if (
    assistant.settings?.reasoning_effort &&
    assistant.settings.reasoning_effort !== 'default' &&
    isClaudeReasoningModel(model)
  ) {
    return undefined
  }

  if (!isSupportTemperatureModel(model, assistant)) {
    return undefined
  }

  let temperature = assistant.settings?.temperature ?? DEFAULT_ASSISTANT_SETTINGS.temperature

  if (isMaxTemperatureOneModel(model)) {
    temperature = Math.min(1, temperature)
  }

  // Use temperature if topP is enabled and model only accepts one of the two
  if (isTemperatureTopPMutuallyExclusiveModel(model) && assistant.settings?.enableTopP) {
    logger.warn(`Model ${model.id} only accepts one of temperature and topP, using temperature instead`)
  }

  return temperature
}

/**
 * Retrieves the TopP parameter, adapting it based on assistant.settings and model capabilities.
 * - Disabled for Claude reasoning models when reasoning effort is set.
 * - Disabled for models that do not support TopP.
 * - Disabled for Claude 4.5 reasoning models when temperature is explicitly enabled.
 * Otherwise, returns the TopP value if the assistant has TopP enabled.
 */
export function getTopP(assistant: Assistant, model: Model): number | undefined {
  const enableTopP = assistant.settings?.enableTopP ?? DEFAULT_ASSISTANT_SETTINGS.enableTopP
  if (!enableTopP) {
    return undefined
  }

  // Thinking isn't compatible with temperature or top_k modifications as well as forced tool use.
  // See: https://platform.claude.com/docs/en/build-with-claude/extended-thinking#feature-compatibility
  if (
    assistant.settings?.reasoning_effort &&
    assistant.settings.reasoning_effort !== 'default' &&
    isClaudeReasoningModel(model)
  ) {
    return undefined
  }
  if (!isSupportTopPModel(model, assistant)) {
    return undefined
  }
  if (isTemperatureTopPMutuallyExclusiveModel(model) && assistant.settings?.enableTemperature) {
    logger.warn(`Model ${model.id} only accepts one of temperature and topP. Drop topP and use temperature instead`)
    return undefined
  }

  return assistant.settings?.topP ?? DEFAULT_ASSISTANT_SETTINGS.topP
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
