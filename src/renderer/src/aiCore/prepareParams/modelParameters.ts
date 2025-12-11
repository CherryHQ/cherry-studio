/**
 * 模型基础参数处理模块
 * 处理温度、TopP、超时等基础参数的获取逻辑
 */

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
import type { Assistant, Model } from '@renderer/types'
import { defaultTimeout } from '@shared/config/constant'

import { getAnthropicThinkingBudget } from '../utils/reasoning'

/**
 * Retrieves the temperature parameter, adapting it based on assistant.settings and model capabilities.
 * - Disabled for Claude reasoning models when reasoning effort is set.
 * - Disabled for models that do not support temperature.
 * - Disabled for Claude 4.5 reasoning models when TopP is enabled and temperature is disabled.
 * Otherwise, returns the temperature value if the assistant has temperature enabled.
 */
export function getTemperature(assistant: Assistant, model: Model): number | undefined {
  if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
    return undefined
  }

  if (!isSupportTemperatureModel(model)) {
    return undefined
  }

  if (
    isTemperatureTopPMutuallyExclusiveModel(model) &&
    assistant.settings?.enableTopP &&
    !assistant.settings?.enableTemperature
  ) {
    return undefined
  }

  const assistantSettings = getAssistantSettings(assistant)
  let temperature = assistantSettings?.temperature
  if (temperature && isMaxTemperatureOneModel(model)) {
    temperature = Math.min(1, temperature)
  }

  // FIXME: assistant.settings.enableTemperature should be always a boolean value.
  const enableTemperature = assistantSettings?.enableTemperature ?? DEFAULT_ASSISTANT_SETTINGS.enableTemperature
  // Ensure temperature is always returned as a number (not a string)
  return enableTemperature && temperature !== undefined ? Number(temperature) : undefined
}

/**
 * Retrieves the TopP parameter, adapting it based on assistant.settings and model capabilities.
 * - Disabled for Claude reasoning models when reasoning effort is set.
 * - Disabled for models that do not support TopP.
 * - Disabled for Claude 4.5 reasoning models when temperature is explicitly enabled.
 * Otherwise, returns the TopP value if the assistant has TopP enabled.
 */
export function getTopP(assistant: Assistant, model: Model): number | undefined {
  if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
    return undefined
  }
  if (!isSupportTopPModel(model)) {
    return undefined
  }
  if (isTemperatureTopPMutuallyExclusiveModel(model) && assistant.settings?.enableTemperature) {
    return undefined
  }

  const assistantSettings = getAssistantSettings(assistant)
  // FIXME: assistant.settings.enableTopP should be always a boolean value.
  const enableTopP = assistantSettings.enableTopP ?? DEFAULT_ASSISTANT_SETTINGS.enableTopP
  const topP = assistantSettings?.topP
  // Ensure topP is always returned as a number (not a string)
  return enableTopP && topP !== undefined ? Number(topP) : undefined
}

/**
 * 获取超时设置
 */
export function getTimeout(model: Model): number {
  if (isSupportedFlexServiceTier(model)) {
    return 15 * 1000 * 60
  }
  return defaultTimeout
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

  // Ensure maxTokens is a number
  maxTokens = Number(maxTokens)

  const provider = getProviderByModel(model)
  if (isSupportedThinkingTokenClaudeModel(model) && ['anthropic', 'aws-bedrock'].includes(provider.type)) {
    const { reasoning_effort: reasoningEffort } = assistantSettings
    const budget = getAnthropicThinkingBudget(maxTokens, reasoningEffort, model.id)
    if (budget) {
      maxTokens -= budget
    }
  }
  return maxTokens
}
