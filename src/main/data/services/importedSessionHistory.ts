import { and, eq, gte, isNull, lt, sql, type SQL } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import type { DbOrTx } from '@data/db/types'
import {
  AgentSessionImportMetadataSchema,
  MessageProvenanceSchema,
  type AgentSessionImportMetadata,
  type MessageProvenance
} from '@shared/data/types/conversationImport'

import { sessionMessageOrdering } from './agentSessionMessageOrder'

const sessionPrefix = 'conversation-import:session:'
const messagePrefix = 'conversation-import:message:'
const InitializationSchema = z.strictObject({
  nativeSessionId: z.string().uuid(),
  status: z.enum(['pending', 'ready']),
  messageCount: z.number().int().nonnegative()
})
const StateSchema = z.strictObject({
  version: z.literal(1),
  metadata: AgentSessionImportMetadataSchema,
  initialization: InitializationSchema.optional()
})
export type ImportedHistoryState = z.infer<typeof InitializationSchema>

function keyRange(prefix: string) {
  return and(gte(appStateTable.key, prefix), lt(appStateTable.key, prefix + '\uffff'))!
}

export function importedMetadataSql(sessionId: SQL | typeof agentSessionTable.id) {
  return sql<AgentSessionImportMetadata | null>`(SELECT json_extract(value, '$.metadata') FROM app_state WHERE key = ${sessionPrefix} || ${sessionId})`.mapWith(
    (value) => (value == null ? null : AgentSessionImportMetadataSchema.parse(JSON.parse(value)))
  )
}

export function messageProvenanceSql() {
  return sql<MessageProvenance | null>`(SELECT value FROM app_state WHERE key = ${messagePrefix} || ${agentSessionMessageTable.sessionId} || ':' || ${agentSessionMessageTable.id})`.mapWith(
    (value) => (value == null ? null : MessageProvenanceSchema.parse(JSON.parse(value)))
  )
}

export function findImportedSessionTx(tx: DbOrTx, source: string, originalSessionId: string) {
  return tx
    .select({ session: agentSessionTable })
    .from(appStateTable)
    .innerJoin(
      agentSessionTable,
      eq(agentSessionTable.id, sql`substr(${appStateTable.key}, ${sessionPrefix.length + 1})`)
    )
    .where(
      and(
        keyRange(sessionPrefix),
        sql`json_extract(${appStateTable.value}, '$.metadata.source') = ${source}`,
        sql`json_extract(${appStateTable.value}, '$.metadata.originalSessionId') = ${originalSessionId}`
      )
    )
    .limit(1)
    .get()?.session
}

export function hasImportedMessageOrder(db: DbOrTx, sessionId: string): boolean {
  const prefix = messagePrefix + sessionId + ':'
  return Boolean(
    db
      .select({ key: appStateTable.key })
      .from(appStateTable)
      .where(and(keyRange(prefix), sql`json_extract(${appStateTable.value}, '$.source') = 'workbuddy'`))
      .limit(1)
      .get()
  )
}

export function setImportedMetadataTx(tx: DbOrTx, sessionId: string, metadata: AgentSessionImportMetadata): void {
  tx.insert(appStateTable)
    .values({
      key: sessionPrefix + sessionId,
      value: { version: 1, metadata: AgentSessionImportMetadataSchema.parse(metadata) }
    })
    .run()
}

export function setMessageProvenanceTx(
  tx: DbOrTx,
  sessionId: string,
  messageId: string,
  provenance: MessageProvenance
): void {
  tx.insert(appStateTable)
    .values({
      key: messagePrefix + sessionId + ':' + messageId,
      value: { source: provenance.source, sourceOrder: provenance.sourceOrder }
    })
    .run()
}

export function deleteMessageProvenanceTx(tx: DbOrTx, sessionId: string, messageId: string): void {
  tx.delete(appStateTable)
    .where(eq(appStateTable.key, messagePrefix + sessionId + ':' + messageId))
    .run()
  const row = tx
    .select()
    .from(appStateTable)
    .where(eq(appStateTable.key, sessionPrefix + sessionId))
    .get()
  if (!row) return
  const state = StateSchema.parse(row.value)
  if (state.initialization) {
    state.initialization.messageCount = tx
      .select({ count: sql<number>`count(*)` })
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, sessionId))
      .get()!.count
    tx.update(appStateTable).set({ value: state }).where(eq(appStateTable.key, row.key)).run()
  }
}

export function getImportedHistoryState(sessionId: string): ImportedHistoryState | undefined {
  const row = application
    .get('DbService')
    .getDb()
    .select()
    .from(appStateTable)
    .where(eq(appStateTable.key, sessionPrefix + sessionId))
    .get()
  return row ? StateSchema.parse(row.value).initialization : undefined
}
export function queueImportedHistoryTx(
  tx: DbOrTx,
  sessionId: string,
  nativeSessionId: string,
  messageCount: number
): void {
  tx.update(appStateTable)
    .set({
      value: sql`json_set(${appStateTable.value}, '$.initialization', json(${JSON.stringify({ nativeSessionId, status: 'pending', messageCount })}))`
    })
    .where(eq(appStateTable.key, sessionPrefix + sessionId))
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
    .select({ row: agentSessionMessageTable, provenance: messageProvenanceSql() })
    .from(agentSessionMessageTable)
    .where(eq(agentSessionMessageTable.sessionId, sessionId))
    .orderBy(...sessionMessageOrdering(db, sessionId).orderBy)
    .all()
    .map(({ row, provenance }) => ({ ...row, provenance }))
  return { ...session, messages }
}
export function completeImportedHistoryTx(tx: DbOrTx, sessionId: string, state: ImportedHistoryState): void {
  tx.update(appStateTable)
    .set({
      value: sql`json_set(${appStateTable.value}, '$.initialization', json(${JSON.stringify({ ...state, status: 'ready' })}))`
    })
    .where(eq(appStateTable.key, sessionPrefix + sessionId))
    .run()
}
export function deleteImportedHistoryTx(tx: DbOrTx, sessionIds: readonly string[]): void {
  for (const id of sessionIds) {
    tx.delete(appStateTable)
      .where(eq(appStateTable.key, sessionPrefix + id))
      .run()
    tx.delete(appStateTable)
      .where(keyRange(messagePrefix + id + ':'))
      .run()
  }
}
