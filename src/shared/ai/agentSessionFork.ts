export const AGENT_SESSION_FORK_UNAVAILABLE_REASONS = [
  'legacy_history',
  'not_turn_boundary',
  'checkpoint_failed',
  'history_missing',
  'history_corrupt',
  'unsupported_checkpoint',
  'history_changed'
] as const

export type AgentSessionForkUnavailableReason = (typeof AGENT_SESSION_FORK_UNAVAILABLE_REASONS)[number]

export function isAgentSessionForkUnavailableReason(value: unknown): value is AgentSessionForkUnavailableReason {
  return typeof value === 'string' && AGENT_SESSION_FORK_UNAVAILABLE_REASONS.some((reason) => reason === value)
}

export function canRebuildAgentSessionFork(reason: string): boolean {
  return isAgentSessionForkUnavailableReason(reason) && reason !== 'not_turn_boundary'
}

export const AGENT_SESSION_FORK_FAILURE_REASONS = [
  ...AGENT_SESSION_FORK_UNAVAILABLE_REASONS,
  'workspace_changed',
  'workspace_unsupported_file',
  'source_missing',
  'source_changed',
  'operation_failed'
] as const

export type AgentSessionForkFailureReason = (typeof AGENT_SESSION_FORK_FAILURE_REASONS)[number]

export function isAgentSessionForkFailureReason(value: unknown): value is AgentSessionForkFailureReason {
  return typeof value === 'string' && AGENT_SESSION_FORK_FAILURE_REASONS.some((reason) => reason === value)
}

export type AgentSessionForkAvailability =
  | { status: 'available' }
  | { status: 'unavailable'; reason: AgentSessionForkUnavailableReason }
