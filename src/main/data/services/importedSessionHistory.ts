import { and, asc, eq, isNull } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import type { DbOrTx } from '@data/db/types'

const prefix = 'conversation-import:'
const StateSchema = z.strictObject({
  version: z.literal(1),
  nativeSessionId: z.string().uuid(),
  status: z.enum(['pending', 'ready']),
  messageCount: z.number().int().positive()
})
export type ImportedHistoryState = z.infer<typeof StateSchema>

export function getImportedHistoryState(sessionId: string): ImportedHistoryState | undefined {
  const row = application
    .get('DbService')
    .getDb()
    .select()
    .from(appStateTable)
    .where(eq(appStateTable.key, prefix + sessionId))
    .get()
  return row ? StateSchema.parse(row.value) : undefined
}
export function queueImportedHistoryTx(
  tx: DbOrTx,
  sessionId: string,
  nativeSessionId: string,
  messageCount: number
): void {
  tx.insert(appStateTable)
    .values({
      key: prefix + sessionId,
      value: { version: 1, nativeSessionId, status: 'pending', messageCount } satisfies ImportedHistoryState
    })
    .run()
}
export function readImportedHistory(sessionId: string) {
  const db = application.get('DbService').getDb()
  const session = db
    .select({ session: agentSessionTable, workspace: agentWorkspaceTable, agent: agentTable })
    .from(agentSessionTable)
    .innerJoin(agentWorkspaceTable, eq(agentWorkspaceTable.id, agentSessionTable.workspaceId))
    .innerJoin(agentTable, eq(agentTable.id, agentSessionTable.agentId))
    .where(and(eq(agentSessionTable.id, sessionId), isNull(agentSessionTable.deletedAt), isNull(agentTable.deletedAt)))
    .get()
  if (!session || session.agent.type !== 'pi') throw new Error('target_changed')
  const messages = db
    .select()
    .from(agentSessionMessageTable)
    .where(eq(agentSessionMessageTable.sessionId, sessionId))
    .orderBy(asc(agentSessionMessageTable.createdAt), asc(agentSessionMessageTable.id))
    .all()
  return { ...session, messages }
}
export function completeImportedHistoryTx(tx: DbOrTx, sessionId: string, state: ImportedHistoryState): void {
  tx.update(appStateTable)
    .set({ value: { ...state, status: 'ready' } })
    .where(eq(appStateTable.key, prefix + sessionId))
    .run()
}
export function deleteImportedHistoryTx(tx: DbOrTx, sessionIds: readonly string[]): void {
  for (const id of sessionIds)
    tx.delete(appStateTable)
      .where(eq(appStateTable.key, prefix + id))
      .run()
}
