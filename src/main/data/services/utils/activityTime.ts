import type { MessageStatus } from '@shared/data/types/message'

const TERMINAL_MESSAGE_STATUSES = new Set<MessageStatus>(['success', 'error', 'paused'])

export function isTerminalMessageStatus(status: string): status is Exclude<MessageStatus, 'pending'> {
  return TERMINAL_MESSAGE_STATUSES.has(status as MessageStatus)
}

/** Preserve the first terminal transition even if later persistence rewrites the message row. */
export function resolveResponseTerminalAt(input: {
  existingTerminalAt?: number | null
  role: string
  status: string
  timestamp: number
}): number | null {
  if (input.existingTerminalAt != null) return input.existingTerminalAt
  return input.role === 'assistant' && isTerminalMessageStatus(input.status) ? input.timestamp : null
}

/** Activity contribution of one persisted content row. Structural/system rows contribute nothing. */
export function getMessageActivityTimestamp(input: {
  createdAt: number
  role: string
  terminalAt?: number | null
}): number | null {
  if (input.role === 'user') return input.createdAt
  if (input.role !== 'assistant') return null
  return Math.max(input.createdAt, input.terminalAt ?? input.createdAt)
}
