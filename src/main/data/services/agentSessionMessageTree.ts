import { isToolUIPart } from 'ai'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import {
  agentSessionMessagePartTable as messageParts,
  type AgentSessionMessageRow,
  type AgentSessionMessageStoredData,
  agentSessionMessageTable as messages,
  type InsertAgentSessionMessagePartRow,
  agentSessionToolOutputTable as toolOutputs
} from '@data/db/schemas/agentSessionMessage'
import type { DbOrTx } from '@data/db/types'
import { isDeferredToolOutput } from '@shared/ai/transport'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { CherryMessagePart } from '@shared/data/types/message'

const SQLITE_INARRAY_CHUNK = 500

/** Message data assembled from the container row and its ordered part rows. */
export type AgentSessionMessageData = AgentSessionMessageStoredData & { parts?: CherryMessagePart[] }
export type WithAgentSessionMessageParts<T extends { data: AgentSessionMessageStoredData }> = Omit<T, 'data'> & {
  data: T['data'] & { parts: CherryMessagePart[] }
}
export type AgentSessionMessageRecord = WithAgentSessionMessageParts<AgentSessionMessageRow>

/** Attaches each message's ordered parts; the part table is the only persisted body source. */
export function attachAgentSessionMessagePartsTx<T extends { id: string; data: AgentSessionMessageStoredData }>(
  db: DbOrTx,
  rows: T[]
): WithAgentSessionMessageParts<T>[] {
  const partsByMessageId = new Map<string, CherryMessagePart[]>()
  const ids = rows.map((row) => row.id)
  for (let index = 0; index < ids.length; index += SQLITE_INARRAY_CHUNK) {
    const stored = db
      .select({ messageId: messageParts.messageId, payload: messageParts.payload })
      .from(messageParts)
      .where(inArray(messageParts.messageId, ids.slice(index, index + SQLITE_INARRAY_CHUNK)))
      .orderBy(asc(messageParts.messageId), asc(messageParts.seq))
      .all()
    for (const part of stored) {
      const parts = partsByMessageId.get(part.messageId)
      if (parts) parts.push(part.payload)
      else partsByMessageId.set(part.messageId, [part.payload])
    }
  }
  return rows.map((row) => ({ ...row, data: { ...row.data, parts: partsByMessageId.get(row.id) ?? [] } }))
}

/** Splits assembled data into the container's stored metadata and its ordered body parts. */
export function splitAgentSessionMessageData(data: AgentSessionMessageData): {
  data: AgentSessionMessageStoredData
  parts: CherryMessagePart[]
} {
  const { parts = [], ...stored } = data
  return { data: stored, parts }
}

/** Bulk part rows for a fresh message; IDs come from the column default. */
export function agentSessionMessagePartRows(input: {
  sessionId: string
  messageId: string
  parts: readonly CherryMessagePart[]
  timestampMs: number
}): InsertAgentSessionMessagePartRow[] {
  const { sessionId, messageId, parts, timestampMs } = input
  return parts.map((part, seq) => ({
    messageId,
    sessionId,
    seq,
    type: part.type,
    payload: part,
    createdAt: timestampMs,
    updatedAt: timestampMs
  }))
}

/** Reads a message's part IDs in body order, parallel to its assembled `parts`. */
export function readAgentSessionMessagePartIdsTx(db: DbOrTx, messageId: string): string[] {
  return db
    .select({ id: messageParts.id })
    .from(messageParts)
    .where(eq(messageParts.messageId, messageId))
    .orderBy(asc(messageParts.seq))
    .all()
    .map((row) => row.id)
}

/**
 * Makes `order` the message's part list: drops parts outside it, re-sequences the rest and writes
 * `parts` by ID. Rows whose payload and position are unchanged are not rewritten.
 */
export function writeAgentSessionMessagePartsTx(
  db: DbOrTx,
  input: {
    sessionId: string
    messageId: string
    order: readonly string[]
    parts: ReadonlyMap<string, CherryMessagePart>
    timestampMs: number
  }
): void {
  const { sessionId, messageId, order, parts, timestampMs } = input
  const seqById = new Map(order.map((id, seq) => [id, seq]))
  if (seqById.size !== order.length) throw new Error('Agent session message part IDs must be unique')
  const existing = db
    .select({ id: messageParts.id, seq: messageParts.seq, type: messageParts.type })
    .from(messageParts)
    .where(eq(messageParts.messageId, messageId))
    .all()
  let textChanged = [...parts.values()].some((part) => part.type === 'text')
  const removed = existing.filter((row) => !seqById.has(row.id))
  const moved = existing.filter((row) => seqById.has(row.id) && seqById.get(row.id) !== row.seq)
  textChanged ||= [...removed, ...moved].some((row) => row.type === 'text')
  for (const [rows, apply] of [
    [removed, (ids: string[]) => db.delete(messageParts).where(inArray(messageParts.id, ids)).run()],
    // Negative seqs free the unique (message, seq) slots before rows take their new positions.
    [
      moved,
      (ids: string[]) =>
        db
          .update(messageParts)
          .set({ seq: sql`-1 - ${messageParts.seq}` })
          .where(inArray(messageParts.id, ids))
          .run()
    ]
  ] as const) {
    const ids = rows.map((row) => row.id)
    for (let index = 0; index < ids.length; index += SQLITE_INARRAY_CHUNK)
      apply(ids.slice(index, index + SQLITE_INARRAY_CHUNK))
  }
  for (const row of moved) {
    if (!parts.has(row.id))
      db.update(messageParts)
        .set({ seq: seqById.get(row.id)! })
        .where(eq(messageParts.id, row.id))
        .run()
  }
  for (const [id, part] of parts) {
    const seq = seqById.get(id)
    if (seq === undefined) throw new Error('Agent session message part is outside the message order')
    db.insert(messageParts)
      .values({
        id,
        messageId,
        sessionId,
        seq,
        type: part.type,
        payload: part,
        createdAt: timestampMs,
        updatedAt: timestampMs
      })
      .onConflictDoUpdate({
        target: messageParts.id,
        set: { seq, type: part.type, payload: part, updatedAt: timestampMs },
        setWhere: sql`${messageParts.payload} IS NOT excluded.payload OR ${messageParts.seq} IS NOT excluded.seq`
      })
      .run()
  }
  if (!textChanged) return
  const text = db
    .select({ text: sql<string | null>`json_extract(${messageParts.payload}, '$.text')` })
    .from(messageParts)
    .where(and(eq(messageParts.messageId, messageId), eq(messageParts.type, 'text')))
    .orderBy(asc(messageParts.seq))
    .all()
  // Callers own the container timestamp; keep the column's auto-update from overwriting it.
  db.update(messages)
    .set({
      searchableText: text.flatMap((row) => (typeof row.text === 'string' ? [row.text] : [])).join('\n'),
      updatedAt: messages.updatedAt
    })
    .where(eq(messages.id, messageId))
    .run()
}

/**
 * Replaces a message's ordered body and its searchable text; the message row must already exist.
 * `partIds` keep stored identities, so unchanged parts are not rewritten; without them every part
 * gets a new ID.
 */
export function replaceAgentSessionMessagePartsTx(
  db: DbOrTx,
  input: {
    sessionId: string
    messageId: string
    parts: readonly CherryMessagePart[]
    partIds?: readonly string[]
    timestampMs: number
  }
): void {
  const { parts, partIds = parts.map(() => uuidv7()) } = input
  if (partIds.length !== parts.length) throw new Error('Agent session message part IDs must parallel its parts')
  writeAgentSessionMessagePartsTx(db, {
    ...input,
    order: partIds,
    parts: new Map(partIds.map((id, index) => [id, parts[index]]))
  })
}

export function hydrateAgentSessionMessageDataTx<T extends AgentSessionMessageData>(
  db: DbOrTx,
  messageId: string,
  data: T
): T {
  const parts = data.parts
  if (!parts?.length) return data
  if (
    !parts.some((part) => isToolUIPart(part) && part.state === 'output-available' && isDeferredToolOutput(part.output))
  ) {
    return data
  }
  const stored = db
    .select({
      toolCallId: toolOutputs.toolCallId,
      output: toolOutputs.output
    })
    .from(toolOutputs)
    .where(eq(toolOutputs.messageId, messageId))
    .all()
  if (stored.length === 0) return data
  const outputsByCallId = new Map(stored.map((item) => [item.toolCallId, item.output]))
  let hydratedParts: typeof parts | undefined
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!isToolUIPart(part) || part.state !== 'output-available' || !isDeferredToolOutput(part.output)) continue
    if (!outputsByCallId.has(part.toolCallId)) continue
    hydratedParts ??= [...parts]
    hydratedParts[index] = { ...part, output: outputsByCallId.get(part.toolCallId) }
  }
  return hydratedParts ? { ...data, parts: hydratedParts } : data
}

export function hydrateAgentSessionMessageRowsTx<
  T extends { id: string; data: AgentSessionMessageStoredData & { parts: CherryMessagePart[] } }
>(db: DbOrTx, rows: T[]): T[] {
  const deferredMessageIds: string[] = []
  for (const row of rows) {
    const parts = row.data.parts
    if (!parts?.length) continue
    if (
      parts.some((part) => isToolUIPart(part) && part.state === 'output-available' && isDeferredToolOutput(part.output))
    ) {
      deferredMessageIds.push(row.id)
    }
  }
  if (deferredMessageIds.length === 0) return rows

  const outputsByKey = new Map<string, unknown>()
  for (let index = 0; index < deferredMessageIds.length; index += SQLITE_INARRAY_CHUNK) {
    const stored = db
      .select({
        messageId: toolOutputs.messageId,
        toolCallId: toolOutputs.toolCallId,
        output: toolOutputs.output
      })
      .from(toolOutputs)
      .where(inArray(toolOutputs.messageId, deferredMessageIds.slice(index, index + SQLITE_INARRAY_CHUNK)))
      .all()
    for (const item of stored) {
      outputsByKey.set(`${item.messageId}\0${item.toolCallId}`, item.output)
    }
  }
  if (outputsByKey.size === 0) return rows

  return rows.map((row) => {
    const parts = row.data.parts
    if (!parts?.length) return row
    let hydratedParts: typeof parts | undefined
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]
      if (!isToolUIPart(part) || part.state !== 'output-available' || !isDeferredToolOutput(part.output)) continue
      const key = `${row.id}\0${part.toolCallId}`
      if (!outputsByKey.has(key)) continue
      hydratedParts ??= [...parts]
      hydratedParts[index] = { ...part, output: outputsByKey.get(key) }
    }
    return hydratedParts ? { ...row, data: { ...row.data, parts: hydratedParts } } : row
  })
}

export function ensureAgentSessionRootTx(db: DbOrTx, sessionId: string): string {
  const root = db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'root')))
    .get()
  if (root) return root.id
  const created = db
    .insert(messages)
    .values({
      sessionId,
      role: 'root',
      data: {},
      status: 'success'
    })
    .returning({ id: messages.id })
    .get()
  db.update(sessions).set({ activeNodeId: created.id }).where(eq(sessions.id, sessionId)).run()
  return created.id
}

export function getAgentSessionHead(db: DbOrTx, sessionId: string): string | null {
  const session = db
    .select({ activeNodeId: sessions.activeNodeId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get()
  if (!session) throw DataApiErrorFactory.notFound('Session', sessionId)
  return session.activeNodeId
}

export function agentSessionPathIds(sessionId: string, head: string) {
  return sql`(with recursive path(id, parent_id) as (
    select id, parent_id from agent_session_message where session_id = ${sessionId} and id = ${head}
    union
    select m.id, m.parent_id from agent_session_message m join path p on m.id = p.parent_id
      where m.session_id = ${sessionId}
  ) select id from path)`
}

export function readAgentSessionPath(db: DbOrTx, sessionId: string, head?: string | null) {
  const selected = head ?? getAgentSessionHead(db, sessionId)
  if (!selected) return []
  const rows = db
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), inArray(messages.id, agentSessionPathIds(sessionId, selected))))
    .all()
  return hydrateAgentSessionMessageRowsTx(
    db,
    attachAgentSessionMessagePartsTx(
      db,
      orderAgentSessionPath(rows, selected).filter((row) => row.role !== 'root')
    )
  )
}

export function readAgentSessionAncestry(db: DbOrTx, sessionId: string, head: string) {
  const rows = db
    .select({ id: messages.id, parentId: messages.parentId })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), inArray(messages.id, agentSessionPathIds(sessionId, head))))
    .all()
  return orderAgentSessionPath(rows, head)
}

export function orderAgentSessionPath<T extends { id: string; parentId: string | null }>(
  rows: T[],
  selected: string
): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const path: T[] = []
  let row = byId.get(selected)
  while (row) {
    path.push(row)
    byId.delete(row.id)
    row = row.parentId ? byId.get(row.parentId) : undefined
  }
  return path.reverse()
}

export function validateAgentSessionParent(db: DbOrTx, sessionId: string, parentId: string): void {
  if (
    !db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.id, parentId)))
      .get()
  ) {
    throw DataApiErrorFactory.notFound('Message parent', parentId)
  }
}

export function advanceAgentSessionHeadTx(db: DbOrTx, sessionId: string, parentId: string, messageId: string): void {
  db.update(sessions)
    .set({ activeNodeId: messageId })
    .where(and(eq(sessions.id, sessionId), eq(sessions.activeNodeId, parentId)))
    .run()
}
