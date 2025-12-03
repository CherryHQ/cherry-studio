/**
 * 模型基础参数处理模块
 * 处理温度、TopP、超时等基础参数的获取逻辑
 */

import {
  isClaude45ReasoningModel,
  isClaudeReasoningModel,
  isMaxTemperatureOneModel,
  isSupportedFlexServiceTier,
  isSupportedThinkingTokenClaudeModel,
  isSupportTemperatureModel,
  isSupportTopPModel
} from '@renderer/config/models'
import { getAssistantSettings, getProviderByModel } from '@renderer/services/AssistantService'
import type { Assistant, Model } from '@renderer/types'
import { defaultTimeout } from '@shared/config/constant'

import { getAnthropicThinkingBudget } from '../utils/reasoning'

/**
 * Claude 4.5 推理模型:
 * - 只启用 temperature → 使用 temperature
 * - 只启用 top_p → 使用 top_p
 * - 同时启用 → temperature 生效,top_p 被忽略
 * - 都不启用 → 都不使用
 * 获取温度参数
 */
export function getTemperature(assistant: Assistant, model: Model): number | undefined {
  if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
    return undefined
  }
  if (
    !isSupportTemperatureModel(model) ||
    (isClaude45ReasoningModel(model) && assistant.settings?.enableTopP && !assistant.settings?.enableTemperature)
  ) {
    return undefined
  }
  const assistantSettings = getAssistantSettings(assistant)
  let temperature = assistantSettings?.temperature
  if (temperature && isMaxTemperatureOneModel(model)) {
    temperature = Math.min(1, temperature)
  }
  return assistantSettings?.enableTemperature ? temperature : undefined
}

/**
 * 获取 TopP 参数
 */
export function getTopP(assistant: Assistant, model: Model): number | undefined {
  if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
    return undefined
  }
  if (!isSupportTopPModel(model) || (isClaude45ReasoningModel(model) && assistant.settings?.enableTemperature)) {
    return undefined
  }
  const assistantSettings = getAssistantSettings(assistant)
  return assistantSettings?.enableTopP ? assistantSettings?.topP : undefined
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
