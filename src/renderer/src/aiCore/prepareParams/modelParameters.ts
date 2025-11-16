/**
 * 模型基础参数处理模块
 * 处理温度、TopP、超时等基础参数的获取逻辑
 */

import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
  isClaude45ReasoningModel,
  isClaudeReasoningModel,
  isNotSupportTemperatureAndTopP,
  isSupportedFlexServiceTier,
  isSupportedThinkingTokenClaudeModel
} from '@renderer/config/models'
import { getAssistantSettings, getProviderByModel } from '@renderer/services/AssistantService'
import type { Assistant, Model } from '@renderer/types'
import { defaultTimeout } from '@shared/config/constant'

import { getAnthropicThinkingBudget } from '../utils/reasoning'

/**
 * 获取温度参数
 */
export function getTemperature(assistant: Assistant, model: Model): number | undefined {
  if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
    return undefined
  }
  if (
    isNotSupportTemperatureAndTopP(model) ||
    (isClaude45ReasoningModel(model) && assistant.settings?.enableTopP && !assistant.settings?.enableTemperature)
  ) {
    return undefined
  }
  const assistantSettings = getAssistantSettings(assistant)
  return assistantSettings?.enableTemperature ? assistantSettings?.temperature : undefined
}

/**
 * 获取 TopP 参数
 */
export function getTopP(assistant: Assistant, model: Model): number | undefined {
  if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
    return undefined
  }
  if (
    isNotSupportTemperatureAndTopP(model) ||
    (isClaude45ReasoningModel(model) && assistant.settings?.enableTemperature)
  ) {
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
  let { maxTokens = DEFAULT_MAX_TOKENS } = getAssistantSettings(assistant)

  const provider = getProviderByModel(model)
  if (isSupportedThinkingTokenClaudeModel(model) && ['anthropic', 'aws-bedrock'].includes(provider.type)) {
    maxTokens -= getAnthropicThinkingBudget(assistant, model)
  }
  return maxTokens
}
