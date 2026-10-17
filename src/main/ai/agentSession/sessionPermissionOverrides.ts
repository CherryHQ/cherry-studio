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
 * update carries a new `permission_mode` — the row is then the user's own choice again. That edit
 * retires by agent ownership, not by live entries: a handoff restores its override after
 * `closeSession` removed the entry, so the entry-less override must still die with the edit, and
 * the per-agent epoch lets a pending handoff restore recognize the edit instead of resurrecting
 * what it invalidated.
 */
interface SessionPermissionOverride {
  agentId: string
  mode: AgentPermissionMode
}

const sessionPermissionModes = new Map<string, SessionPermissionOverride>()
const agentPermissionEditEpochs = new Map<string, number>()

export function setSessionEffectivePermissionMode(sessionId: string, agentId: string, mode: AgentPermissionMode): void {
  sessionPermissionModes.set(sessionId, { agentId, mode })
}

export function getSessionEffectivePermissionMode(sessionId: string): AgentPermissionMode | undefined {
  return sessionPermissionModes.get(sessionId)?.mode
}

export function clearSessionEffectivePermissionMode(sessionId: string): void {
  sessionPermissionModes.delete(sessionId)
}

/**
 * An explicit permission edit retires every session override of the agent — live entry or not —
 * and bumps the agent's epoch so a pending handoff restore can tell the edit happened.
 */
export function retireAgentSessionPermissionModes(agentId: string): void {
  for (const [sessionId, override] of sessionPermissionModes) {
    if (override.agentId === agentId) sessionPermissionModes.delete(sessionId)
  }
  agentPermissionEditEpochs.set(agentId, (agentPermissionEditEpochs.get(agentId) ?? 0) + 1)
}

/** Epoch stamp to compare against {@link retireAgentSessionPermissionModes} after an await. */
export function agentPermissionEditEpoch(agentId: string): number {
  return agentPermissionEditEpochs.get(agentId) ?? 0
}
