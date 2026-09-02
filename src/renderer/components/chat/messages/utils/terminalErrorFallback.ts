import { hasRenderableContent, isHiddenMarkerPart, isRenderablePart } from '@shared/data/messageRenderability'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

function isDismissedNoResponseMarker(part: CherryMessagePart): boolean {
  return (
    part.type === 'data-clear' &&
    (part as unknown as { data?: { dismissedNoResponse?: boolean } }).data?.dismissedNoResponse === true
  )
}

/**
 * Appends a localized "no response" error part to assistant messages that ended
 * without any visible content: a `success` status whose parts are all hidden
 * transport markers or empty structured payloads, or an `error` status that has
 * neither visible content nor a `data-error` part. The error branch now also
 * requires `!hasVisiblePart` so an error turn that already shows answer content
 * (e.g. streamed text before the failure) does not get a misleading "No response"
 * block. Shared by the agents and home message list adapters. Returns the input
 * map by reference when nothing changes.
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
    if (parts.some(isDismissedNoResponseMarker)) continue
    const hasVisiblePart = hasRenderableContent(parts)
    const needsFallback =
      (status === 'error' && !parts.some((part) => part.type === 'data-error') && !hasVisiblePart) ||
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

export { hasRenderableContent, isHiddenMarkerPart, isRenderablePart }
