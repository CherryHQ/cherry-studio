import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

/**
 * Per-run policy for an agent session, set by the caller that starts the run and
 * read by `buildClaudeCodeSessionSettings`. Keyed by session id, mirroring the
 * other session-scoped holders in settingsBuilder (approval emitter, steer, tool
 * policy). Interactive runs set nothing (defaults: not autonomous, agent's own
 * permission mode); scheduled-task / heartbeat runs set `autonomous` + the task's
 * `permissionMode`.
 *
 * The warmup request builders take only a session id, so a holder is the cleanest
 * seam to carry run context without threading it through every dispatch layer.
 */
export interface AgentRunPolicy {
  /** True for unattended scheduled-task / heartbeat runs — disables interactive tools. */
  autonomous?: boolean
  /** Per-run permission mode override; falls back to the agent's configured mode. */
  permissionMode?: AgentPermissionMode
}

const runPolicies = new Map<string, AgentRunPolicy>()

export function setAgentRunPolicy(sessionId: string, policy: AgentRunPolicy): void {
  runPolicies.set(sessionId, policy)
}

export function getAgentRunPolicy(sessionId: string): AgentRunPolicy | undefined {
  return runPolicies.get(sessionId)
}

export function clearAgentRunPolicy(sessionId: string): void {
  runPolicies.delete(sessionId)
}
