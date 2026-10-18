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
 * Overrides are retired when the session's runtime entry is removed, when an explicit agent
 * update carries a new `permission_mode` — the row is then the user's own choice again — and
 * when the session is reassigned to another agent. Those retires work by agent ownership, not by
 * live entries: a handoff restores its override after `closeSession` removed the entry, so the
 * entry-less override must still die with the edit or the reassignment. A per-agent edit epoch
 * and a per-session reassignment epoch let a pending handoff restore recognize either instead of
 * resurrecting what they invalidated; the reassignment epoch survives the override's deletion.
 */
interface SessionPermissionOverride {
  agentId: string
  mode: AgentPermissionMode
}

const sessionPermissionModes = new Map<string, SessionPermissionOverride>()
const agentPermissionEditEpochs = new Map<string, number>()
/** Last observed owner per session. It outlives the override: `closeSession` retires that
 *  synchronously, yet a reassignment landing during the handoff teardown must still count. */
const sessionAgentOwners = new Map<string, string | null>()
const sessionReassignmentEpochs = new Map<string, number>()

export function setSessionEffectivePermissionMode(sessionId: string, agentId: string, mode: AgentPermissionMode): void {
  sessionPermissionModes.set(sessionId, { agentId, mode })
  sessionAgentOwners.set(sessionId, agentId)
}

/** The read names the agent the session currently belongs to: a foreign owner's override is dead. */
export function getSessionEffectivePermissionMode(sessionId: string, agentId: string): AgentPermissionMode | undefined {
  const override = sessionPermissionModes.get(sessionId)
  return override?.agentId === agentId ? override.mode : undefined
}

export function clearSessionEffectivePermissionMode(sessionId: string): void {
  sessionPermissionModes.delete(sessionId)
}

/**
 * Whether this session has permission state worth observing on a session update: a live override
 * or an owner recorded for one. Sessions that never entered the handoff stay off the DB path.
 */
export function tracksSessionPermission(sessionId: string): boolean {
  return sessionPermissionModes.has(sessionId) || sessionAgentOwners.has(sessionId)
}

/**
 * A session reassigned to another agent leaves its previous agent's scope: the approved execution
 * must not follow it, and the session's reassignment epoch moves so a pending handoff restore
 * recognizes the reassignment instead of resurrecting what it invalidated. The epoch is keyed on
 * the session's own owner history, not on the override — `closeSession` deletes the override
 * before its connection teardown finishes, and a reassignment in that window must still count.
 */
export function retireReassignedSessionPermissionMode(sessionId: string, currentAgentId: string | null): void {
  const previousAgentId = sessionAgentOwners.get(sessionId)
  sessionAgentOwners.set(sessionId, currentAgentId)
  if (previousAgentId === undefined || previousAgentId === currentAgentId) return
  sessionPermissionModes.delete(sessionId)
  sessionReassignmentEpochs.set(sessionId, (sessionReassignmentEpochs.get(sessionId) ?? 0) + 1)
}

/** Epoch stamp to compare against {@link retireReassignedSessionPermissionMode} after an await. */
export function sessionReassignmentEpoch(sessionId: string): number {
  return sessionReassignmentEpochs.get(sessionId) ?? 0
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
