/**
 * 模型基础参数处理模块
 * 处理温度、TopP、超时等基础参数的获取逻辑
 */

import {
  isClaudeReasoningModel,
  isNotSupportTemperatureAndTopP,
  isSupportedFlexServiceTier
} from '@renderer/config/models'
import { getAssistantSettings } from '@renderer/services/AssistantService'
import type { Assistant, Model } from '@renderer/types'
import { defaultTimeout } from '@shared/config/constant'

/**
 * 获取温度参数
 */
export function getTemperature(assistant: Assistant, model: Model): number | undefined {
  if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
    return undefined
  }
  if (isNotSupportTemperatureAndTopP(model)) {
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
  if (isNotSupportTemperatureAndTopP(model)) {
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
