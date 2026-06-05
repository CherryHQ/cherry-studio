import { isFunctionCallingModel } from '@renderer/config/models'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model, UniqueModelId } from '@shared/data/types/model'

type Translate = (key: string) => string

export const RUNTIME_DEFAULT_ASSISTANT_ID = null
export const RUNTIME_DEFAULT_ASSISTANT_EMOJI = '😀'
export const RUNTIME_DEFAULT_ASSISTANT_ORDER_KEY = ''

export function getRuntimeDefaultAssistantName(t: Translate): string {
  return t('chat.default.name')
}

export function createRuntimeDefaultAssistantDisplay(t: Translate) {
  return {
    id: RUNTIME_DEFAULT_ASSISTANT_ID,
    name: getRuntimeDefaultAssistantName(t),
    emoji: RUNTIME_DEFAULT_ASSISTANT_EMOJI,
    orderKey: RUNTIME_DEFAULT_ASSISTANT_ORDER_KEY
  }
}

export function composeRuntimeDefaultAssistant(modelId: UniqueModelId | null, t: Translate) {
  return {
    id: RUNTIME_DEFAULT_ASSISTANT_ID,
    name: getRuntimeDefaultAssistantName(t),
    emoji: RUNTIME_DEFAULT_ASSISTANT_EMOJI,
    modelId
  }
}

export type RuntimeDefaultAssistant = ReturnType<typeof composeRuntimeDefaultAssistant>
export type RuntimeAssistant = Assistant | RuntimeDefaultAssistant

export function normalizeAssistantId(id: string | null | undefined): string | null {
  return id && id.trim().length > 0 ? id : null
}

export function isRuntimeDefaultAssistantId(id: string | null | undefined): id is null {
  return id === RUNTIME_DEFAULT_ASSISTANT_ID
}

export function isPersistedAssistant(assistant: RuntimeAssistant | null | undefined): assistant is Assistant {
  return !!assistant && !isRuntimeDefaultAssistantId(assistant.id)
}

/**
 * 是否启用工具使用 (function call)。v2 assistant 不再内嵌 model；调用方
 * 从 ToolContext 拿 v2 Model 一起传入。
 */
export function isSupportedToolUse(model: Model | undefined) {
  if (!model) return false
  return isFunctionCallingModel(model)
}
