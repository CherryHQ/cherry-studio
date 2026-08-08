import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { isHiddenPart } from '../blocks/messagePartLayouts'

/**
 * Appends a localized "no response" error part to assistant messages that ended
 * without any visible content: an `error` status that has no `data-error` part
 * yet, or a `success` status whose parts are all hidden transport markers (e.g.
 * an empty stream that only left a `step-start`). Shared by the agents and home
 * message list adapters. Returns the input map by reference when nothing changes.
 */
export function withTerminalErrorFallback(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>,
  noResponseMessage: string
): Record<string, CherryMessagePart[]> {
  let next = partsByMessageId

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const status = message.metadata?.status
    const parts = partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
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
        data: { name: 'AgentRuntimeError', message: noResponseMessage, stack: null }
      }
    ]
  }

  return next
}
