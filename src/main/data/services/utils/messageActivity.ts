import type { MessageRole, MessageStatus } from '@shared/data/types/message'

const TERMINAL_STATUSES = new Set<MessageStatus>(['success', 'error', 'paused'])

/** Activity represented by a newly persisted row, including an already-terminal response. */
export function getInitialMessageActivityAt(
  role: MessageRole,
  status: MessageStatus,
  createdAt: number,
  updatedAt = createdAt
): number | null {
  if (role === 'user') return createdAt
  if (role !== 'assistant') return null
  return TERMINAL_STATUSES.has(status) ? Math.max(createdAt, updatedAt) : createdAt
}

/**
 * Return the activity timestamp for an activity-bearing status transition.
 * Streaming writes and repeated status writes return `null` and do not move
 * the parent clock.
 */
export function getMessageTransitionActivityAt(
  role: MessageRole,
  previousStatus: MessageStatus,
  nextStatus: MessageStatus,
  timestamp: number
): number | null {
  if (role !== 'assistant' || previousStatus === nextStatus) return null
  if (previousStatus === 'pending' && TERMINAL_STATUSES.has(nextStatus)) return timestamp
  return null
}
