import { and, eq, gte, lt, ne, sql, type SQL } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { appStateTable } from '@data/db/schemas/appState'
import type { DbOrTx } from '@data/db/types'
import {
  AgentSessionImportMetadataSchema,
  MessageProvenanceSchema,
  type AgentSessionImportMetadata,
  type MessageProvenance
} from '@shared/data/types/conversationImport'

const sessionPrefix = 'conversation-import:session:'
const messagePrefix = 'conversation-import:message:'
const InitializationSchema = z.strictObject({
  nativeSessionId: z.string().uuid(),
  status: z.enum(['pending', 'ready']),
  messageCount: z.number().int().nonnegative(),
  nativePrefix: z
    .strictObject({ entryCount: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
    .optional()
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
}

export function refreshImportedHistoryMessageCountTx(tx: DbOrTx, sessionId: string): void {
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
      .where(and(eq(agentSessionMessageTable.sessionId, sessionId), ne(agentSessionMessageTable.role, 'root')))
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
