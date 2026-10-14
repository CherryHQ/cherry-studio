import type { Topic } from '@renderer/types/topic'

export type GlobalSearchTopicSelectionPayload = {
  targetTabId: string
  topic: Topic
}

export type GlobalSearchTopicMessageSelectionPayload = GlobalSearchTopicSelectionPayload & {
  messageId: string
}

export type GlobalSearchAgentSessionSelectionPayload = {
  targetTabId: string
  sessionId: string
}

export type GlobalSearchAgentSessionMessageSelectionPayload = GlobalSearchAgentSessionSelectionPayload & {
  messageId: string
}

export function isGlobalSearchSelectionForTab(
  payload: { targetTabId?: string } | null | undefined,
  currentTabId: string | null | undefined
) {
  return !!currentTabId && !!payload?.targetTabId && payload.targetTabId === currentTabId
}
