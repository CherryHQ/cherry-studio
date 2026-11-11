import { isToolUIPart } from 'ai'

import type { CherryUIMessage } from '@shared/data/types/message'

export function selectConversationPreview(messages: readonly CherryUIMessage[]) {
  const pending = messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      isToolUIPart(part) && part.state === 'approval-requested' ? [{ message, part }] : []
    )
  )
  const request = pending[0]
  const visible = messages.filter((message) => message.role !== 'system')
  const lastUserIndex = visible.findLastIndex((message) => message.role === 'user')
  const latest = visible.at(-1)
  const latestTurn =
    lastUserIndex < 0
      ? visible.slice(-2)
      : latest?.role === 'assistant'
        ? [visible[lastUserIndex], latest]
        : [visible[lastUserIndex]]
  return {
    request,
    remainingRequests: Math.max(0, pending.length - 1),
    messages: request ? [{ ...request.message, parts: [request.part] }] : latestTurn
  }
}
