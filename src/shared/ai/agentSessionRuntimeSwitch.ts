import type { AgentType } from '@shared/data/api/schemas/agents'

/**
 * Whether a session may be re-pointed to another agent. Agents on different runtime types keep
 * separate native transcripts and admission does not replay history, so an established
 * conversation (one that already has messages) switching runtimes would silently orphan its
 * earlier context — it must start a new conversation instead. Empty conversations switch freely.
 * Unknown runtime types (agent row missing at the call site) allow, deferring to existence checks.
 */
export function canReassignSessionAgent(input: {
  hasMessages: boolean
  currentRuntime?: AgentType
  nextRuntime?: AgentType
}): boolean {
  if (!input.hasMessages) return true
  return (
    input.currentRuntime === undefined || input.nextRuntime === undefined || input.currentRuntime === input.nextRuntime
  )
}
