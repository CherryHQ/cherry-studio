import type { CherryMessagePart } from '@shared/data/types/message'
import { hasClearContextPart } from '@shared/data/types/uiParts'
import { applyMaxMessagesWindow } from '@shared/utils/contextSettings'

export interface ContextWindowPathRow {
  id: string
  role: string
  data: { parts?: readonly CherryMessagePart[] }
}

export type ContextWindowBoundary = { kind: 'before'; messageId: string } | { kind: 'after-last' }

const NEXT_TURN: ContextWindowPathRow = { id: '', role: 'user', data: {} }

/**
 * Where the next submit's `maxMessages` window starts on the active path, or null when it drops nothing.
 * Mirrors main's history build: rows after the latest clear-context marker plus the new user row, windowed
 * by the same `applyMaxMessagesWindow`. A loaded tail is enough: a non-zero start is a user row in hand.
 */
export function findContextWindowBoundary(
  path: readonly ContextWindowPathRow[],
  maxMessages: number | null,
  options: { nextTurnFillsActiveNode: boolean }
): ContextWindowBoundary | null {
  const rows = path.slice(path.findLastIndex((row) => hasClearContextPart(row.data.parts)) + 1)
  // A reserved blank user leaf is filled in place by the next submit instead of gaining a child.
  const next = options.nextTurnFillsActiveNode ? rows : [...rows, NEXT_TURN]
  const start = next.length - applyMaxMessagesWindow(next, maxMessages).length
  if (start === 0) return null
  if (start === next.length - 1) return { kind: 'after-last' }
  return { kind: 'before', messageId: next[start].id }
}
