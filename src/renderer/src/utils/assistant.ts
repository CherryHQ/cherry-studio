import { isFunctionCallingModel } from '@renderer/config/models'
import type { Assistant } from '@renderer/types'

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
 * 是否启用工具使用(function call)
 * @param assistant
 * @returns 是否启用工具使用
 */
export function isSupportedToolUse(assistant: Assistant) {
  if (assistant.model) {
    return isFunctionCallingModel(assistant.model) && isToolUseModeFunction(assistant)
  }

  return false
}
