import type { AddNewTopicPayload } from '@renderer/services/EventService'

export function resolveNewTopicAssistantId(activeAssistantId: string | undefined, payload?: AddNewTopicPayload) {
  if (payload && 'assistantId' in payload) {
    return payload.assistantId ?? undefined
  }

  return activeAssistantId
}
