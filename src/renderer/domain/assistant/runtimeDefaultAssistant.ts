import i18n from '@renderer/i18n'
import type { Assistant } from '@renderer/types'
import { ASSISTANT_SOURCE_USER, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { UniqueModelId } from '@shared/data/types/model'

type Translate = (key: string) => string

export const RUNTIME_DEFAULT_ASSISTANT_ID = null
export const RUNTIME_DEFAULT_ASSISTANT_EMOJI = '😀'
export const RUNTIME_DEFAULT_ASSISTANT_ORDER_KEY = ''

const DEFAULT_ASSISTANT_TIMESTAMP = new Date(0).toISOString()

export type RuntimeDefaultAssistant = Omit<Assistant, 'id'> & { id: null }
export type RuntimeAssistant = Assistant | RuntimeDefaultAssistant

export type RuntimeDefaultAssistantRef = {
  kind: 'default'
  assistantId: null
}

export type PersistedAssistantRef = {
  kind: 'persisted'
  assistantId: string
}

export type AssistantRef = RuntimeDefaultAssistantRef | PersistedAssistantRef

export function getRuntimeDefaultAssistantName(t: Translate = i18n.t.bind(i18n)): string {
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

export function composeDefaultAssistant(modelId: UniqueModelId | null): RuntimeDefaultAssistant {
  return {
    id: RUNTIME_DEFAULT_ASSISTANT_ID,
    source: ASSISTANT_SOURCE_USER,
    name: getRuntimeDefaultAssistantName(),
    emoji: RUNTIME_DEFAULT_ASSISTANT_EMOJI,
    prompt: '',
    description: '',
    settings: DEFAULT_ASSISTANT_SETTINGS,
    modelId,
    modelName: null,
    orderKey: RUNTIME_DEFAULT_ASSISTANT_ORDER_KEY,
    mcpServerIds: [],
    knowledgeBaseIds: [],
    tags: [],
    createdAt: DEFAULT_ASSISTANT_TIMESTAMP,
    updatedAt: DEFAULT_ASSISTANT_TIMESTAMP
  }
}

export function composeRuntimeDefaultAssistant(modelId: UniqueModelId | null): RuntimeDefaultAssistant {
  return composeDefaultAssistant(modelId)
}

export function normalizeAssistantId(id: string | null | undefined): string | null {
  return id && id.trim().length > 0 ? id : null
}

export function isDefaultAssistantId(id: string | null): id is null {
  return id === RUNTIME_DEFAULT_ASSISTANT_ID
}

export function isRuntimeDefaultAssistantId(id: string | null | undefined): id is null {
  return id === RUNTIME_DEFAULT_ASSISTANT_ID
}

export function toAssistantRef(id: string | null): AssistantRef {
  return isDefaultAssistantId(id) ? { kind: 'default', assistantId: null } : { kind: 'persisted', assistantId: id }
}

export function isRuntimeDefaultAssistantRef(ref: AssistantRef): ref is RuntimeDefaultAssistantRef {
  return ref.kind === 'default'
}

export function isPersistedAssistantRef(ref: AssistantRef): ref is PersistedAssistantRef {
  return ref.kind === 'persisted'
}

export function isRuntimeDefaultAssistant(
  assistant: Pick<RuntimeAssistant, 'id'> | null | undefined
): assistant is RuntimeDefaultAssistant {
  return assistant?.id === RUNTIME_DEFAULT_ASSISTANT_ID
}
