import { isFunctionCallingModel } from '@renderer/config/models'
import type { Assistant, Model } from '@renderer/types'

export const isToolUseModeFunction = (assistant: Assistant) => {
  return assistant.settings?.toolUseMode === 'function'
}

/**
 * 是否使用提示词工具使用
 * @param assistant
 * @returns 是否使用提示词工具使用
 */
export function isPromptToolUse(assistant: Assistant) {
  return assistant.settings?.toolUseMode === 'prompt'
}

/**
 * 是否启用工具使用 (function call)。v2 assistant 不再内嵌 model；调用方
 * 从 ToolContext 拿 v1 Model 一起传入。
 */
export function isSupportedToolUse(assistant: Assistant, model: Model | undefined) {
  if (!model) return false
  return isFunctionCallingModel(model) && isToolUseModeFunction(assistant)
}
