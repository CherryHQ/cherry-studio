import { inArray } from 'drizzle-orm'

import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import type { DbType } from '@data/db/types'

const SQLITE_INARRAY_CHUNK = 500

/**
 * Sessions whose override points at one of `uniqueModelIds`. Read before the delete: `ON DELETE SET NULL`
 * clears `agent_session.model` silently, so mounted conversations must be told to refetch.
 */
export function selectSessionsUsingModelsTx(tx: Pick<DbType, 'select'>, uniqueModelIds: readonly string[]): string[] {
  const sessionIds: string[] = []
  for (let i = 0; i < uniqueModelIds.length; i += SQLITE_INARRAY_CHUNK) {
    const chunk = uniqueModelIds.slice(i, i + SQLITE_INARRAY_CHUNK)
    for (const row of tx
      .select({ id: agentSessionTable.id })
      .from(agentSessionTable)
      .where(inArray(agentSessionTable.model, chunk))
      .all()) {
      sessionIds.push(row.id)
    }
  }
  return sessionIds
}

/** Publish model-deletion effects so model caches and affected session overrides refresh in every window. */
export function notifyModelsDeleted(uniqueModelIds: readonly string[], sessionIds: readonly string[]): void {
  if (uniqueModelIds.length === 0) return
  notifyDataApiDataChange([
    { endpoint: '/models', kind: 'membership', entityIds: [...uniqueModelIds] },
    ...(sessionIds.length > 0 ? [{ endpoint: '/agent-sessions/:sessionId' as const, entityIds: [...sessionIds] }] : [])
  ])
}
