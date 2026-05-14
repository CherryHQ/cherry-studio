import type { PermissionMode, Query } from '@anthropic-ai/claude-agent-sdk'

/**
 * Active `Query` instances keyed by Cherry session id. Populated for the
 * lifetime of an in-flight `processSDKQuery` so runtime controls (e.g.
 * `setPermissionMode`) can reach the SDK without waiting for the next turn.
 */
const activeQueries = new Map<string, Query>()

export function registerActiveQuery(sessionId: string, query: Query): void {
  activeQueries.set(sessionId, query)
}

export function unregisterActiveQuery(sessionId: string): void {
  activeQueries.delete(sessionId)
}

/**
 * Hot-switch the SDK permission mode on the currently running query for a
 * session. Returns `false` when no query is in flight — that's the normal case
 * when the user changes mode between turns; DB is the source of truth and the
 * next `invoke()` will read it.
 */
export async function setActiveSessionPermissionMode(sessionId: string, mode: PermissionMode): Promise<boolean> {
  const q = activeQueries.get(sessionId)
  if (!q) return false
  await q.setPermissionMode(mode)
  return true
}
