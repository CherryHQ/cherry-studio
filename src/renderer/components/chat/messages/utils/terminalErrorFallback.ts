import { isHiddenPart } from '@renderer/components/chat/messages/blocks/messagePartLayouts'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

/**
 * Give a settled turn that rendered nothing an error part to show.
 *
 * Two cases produce a bubble with nothing in it: the turn ended in `error` but no
 * `data-error` part made it into the message, or it was recorded `success` while
 * carrying no visible part at all. Both leave the user staring at an empty reply
 * with no cause and nothing to retry.
 *
 * `stage` is attached when known so the fallback names where it broke instead of
 * repeating a bare "No response" (#20941).
 */
export function withTerminalErrorFallback(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>,
  noResponseMessage: string,
  stage?: string
): Record<string, CherryMessagePart[]> {
  let next = partsByMessageId

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const status = message.metadata?.status
    const parts = partsByMessageId[message.id] ?? message.parts ?? []
    const hasVisiblePart = parts.some((part) => !isHiddenPart(part))
    const needsFallback =
      (status === 'error' && !parts.some((part) => part.type === 'data-error')) ||
      (status === 'success' && !hasVisiblePart)
    if (!needsFallback) continue

    if (next === partsByMessageId) next = { ...partsByMessageId }
    next[message.id] = [
      ...parts,
      {
        type: 'data-error',
        data: {
          name: 'AgentRuntimeError',
          message: noResponseMessage,
          stack: null,
          ...(stage ? { failureStage: stage } : {})
        }
      }
    ]
  }

  return next
}
