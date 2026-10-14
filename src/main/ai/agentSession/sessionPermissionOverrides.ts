import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

/**
 * Session-scoped effective permission modes, consulted by every runtime derivation that would
 * otherwise re-read the shared agent row (`agent.configuration.permission_mode`): SDK startup
 * options and reconcile-time policy facts.
 *
 * The one writer is the plan-execution model handoff: approving a plan shifts the CLI itself into
 * an execution mode for the rest of that session, but the handoff replaces the connection that
 * carried the shift. Persisting it on the agent row instead would reconcile EVERY session of the
 * agent out of its Plan Only restriction, so the approved execution stays a property of the
 * approving session alone and the shared setting is left untouched.
 *
 * Overrides are retired when the session's runtime entry is removed, or when an explicit agent
 * update carries a new `permission_mode` — the row is then the user's own choice again.
 */
const sessionPermissionModes = new Map<string, AgentPermissionMode>()

export function setSessionEffectivePermissionMode(sessionId: string, mode: AgentPermissionMode): void {
  sessionPermissionModes.set(sessionId, mode)
}

export function getSessionEffectivePermissionMode(sessionId: string): AgentPermissionMode | undefined {
  return sessionPermissionModes.get(sessionId)
}

export function clearSessionEffectivePermissionMode(sessionId: string): void {
  sessionPermissionModes.delete(sessionId)
}
