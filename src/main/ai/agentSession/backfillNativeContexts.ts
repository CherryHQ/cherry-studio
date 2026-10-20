import { eq } from 'drizzle-orm'

import { application } from '@application'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'

import { confirmPiContext } from './nativeContext'

/** Associate verified v2 native identities without changing archives or selecting a writer. */
export function backfillNativeContexts(sessionId: string) {
  const rows = application
    .get('DbService')
    .getDb()
    .select()
    .from(agentSessionMessageTable)
    .where(eq(agentSessionMessageTable.sessionId, sessionId))
    .all()
  const ids = new Set(
    rows.flatMap((row) => [row.runtimeResumeToken, row.data.nativeSessionId]).filter((id): id is string => Boolean(id))
  )
  if (!ids.size) return { bound: [], unresolved: [] }
  const backend = contexts.allocateBackend('pi')
  const result: { bound: string[]; unresolved: string[] } = { bound: [], unresolved: [] }
  for (const id of ids) {
    const context = contexts.allocateContext(sessionId, backend.id, id)
    try {
      confirmPiContext(context.id)
      result.bound.push(context.id)
    } catch {
      result.unresolved.push(context.id)
    }
  }
  return result
}
