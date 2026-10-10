import type { MessageStatus } from '@shared/data/types/message'

const TERMINAL_MESSAGE_STATUSES = new Set<MessageStatus>(['success', 'error', 'paused'])

export function isTerminalMessageStatus(status: string): status is Exclude<MessageStatus, 'pending'> {
  return TERMINAL_MESSAGE_STATUSES.has(status as MessageStatus)
}

/** User and assistant rows represent conversation activity; structural/system rows do not. */
export function isConversationActivityRole(role: string): role is 'user' | 'assistant' {
  return role === 'user' || role === 'assistant'
}

/** Advance recency only when an assistant response segment actually finishes. */
export function isAssistantActivityTransition(input: {
  existingStatus: string
  role: string
  status: string
}): boolean {
  return input.role === 'assistant' && input.existingStatus === 'pending' && isTerminalMessageStatus(input.status)
}
