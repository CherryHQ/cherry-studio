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
