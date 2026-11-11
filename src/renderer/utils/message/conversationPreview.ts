import { isToolUIPart } from 'ai'

import type { CherryUIMessage } from '@shared/data/types/message'

export function selectConversationPreview(messages: readonly CherryUIMessage[]) {
  const pending = messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      isToolUIPart(part) && part.state === 'approval-requested' ? [{ message, part }] : []
    )
  )
  const request = pending[0]
  return {
    request,
    remainingRequests: Math.max(0, pending.length - 1),
    messages: request
      ? [{ ...request.message, parts: [request.part] }]
      : messages.filter((message) => message.role !== 'system').slice(-2)
  }
}
