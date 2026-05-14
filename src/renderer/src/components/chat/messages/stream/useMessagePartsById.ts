import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useMemo } from 'react'

export function useMessagePartsById(
  messages: CherryUIMessage[],
  executionMessagesById: Record<string, CherryUIMessage[]>
): Record<string, CherryMessagePart[]> {
  return useMemo(() => {
    const next: Record<string, CherryMessagePart[]> = {}
    const messageIds = new Set<string>()

    for (const message of messages) {
      messageIds.add(message.id)
      next[message.id] = (message.parts ?? []) as CherryMessagePart[]
    }

    for (const execMessages of Object.values(executionMessagesById)) {
      for (const message of execMessages) {
        if (message.role !== 'assistant' || !message.parts?.length) continue
        if (!messageIds.has(message.id)) continue
        next[message.id] = message.parts as CherryMessagePart[]
      }
    }

    return next
  }, [messages, executionMessagesById])
}
