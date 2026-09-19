export const AGENT_SESSION_FORK_FAILURE_REASONS = [
  'legacy_history',
  'not_turn_boundary',
  'history_missing',
  'history_corrupt',
  'unsupported_checkpoint',
  'history_changed',
  'workspace_changed',
  'workspace_unsupported_file',
  'source_missing',
  'source_changed',
  'cancelled',
  'operation_failed'
] as const

export type AgentSessionForkFailureReason = (typeof AGENT_SESSION_FORK_FAILURE_REASONS)[number]

export function isAgentSessionForkFailureReason(value: unknown): value is AgentSessionForkFailureReason {
  return typeof value === 'string' && AGENT_SESSION_FORK_FAILURE_REASONS.some((reason) => reason === value)
}
