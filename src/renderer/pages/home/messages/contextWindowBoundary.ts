import type { CherryMessagePart } from '@shared/data/types/message'
import { hasClearContextPart } from '@shared/data/types/uiParts'
import { applyMaxMessagesWindow, normalizeMaxMessages } from '@shared/utils/contextSettings'

export interface ContextWindowPathRow {
  id: string
  role: string
  data: { parts?: readonly CherryMessagePart[] }
}

type BoundaryPlacement = { kind: 'before'; messageId: string } | { kind: 'after-last' }
export type ContextWindowBoundary = BoundaryPlacement & { precedingMessageId?: string }

const NEXT_TURN: ContextWindowPathRow = { id: '', role: 'user', data: {} }

/**
 * Where the next submit's `maxMessages` window starts on the active path, or null when it drops nothing.
 * Mirrors main's history build: rows after the latest clear-context marker plus the new user row, windowed
 * by the same `applyMaxMessagesWindow`. At the page edge, check the preceding row for a context reset.
 */
export function findContextWindowBoundary(
  path: readonly ContextWindowPathRow[],
  maxMessages: number | null,
  options: { nextTurnFillsActiveNode: boolean; precedingMessageId?: string }
): ContextWindowBoundary | null {
  const limit = normalizeMaxMessages(maxMessages)
  if (limit === null) return null

  const lastClearIndex = path.findLastIndex((row) => hasClearContextPart(row.data.parts))
  const rows = path.slice(lastClearIndex + 1)
  // A reserved blank user leaf is filled in place by the next submit instead of gaining a child.
  const next = options.nextTurnFillsActiveNode ? rows : [...rows, NEXT_TURN]
  const start = next.length - applyMaxMessagesWindow(next, limit).length
  const precedingMessageId =
    start === 0 && lastClearIndex === -1 && next.length >= limit && rows[0]?.role === 'user'
      ? options.precedingMessageId
      : undefined
  if (start === 0 && !precedingMessageId) return null

  const placement: BoundaryPlacement =
    start === next.length - 1 ? { kind: 'after-last' } : { kind: 'before', messageId: next[start].id }
  return precedingMessageId ? { ...placement, precedingMessageId } : placement
}
