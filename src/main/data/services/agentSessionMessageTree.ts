import { isToolUIPart } from 'ai'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import {
  type AgentSessionMessageRow,
  agentSessionMessageTable as messages,
  agentSessionToolOutputTable as toolOutputs
} from '@data/db/schemas/agentSessionMessage'
import type { DbOrTx } from '@data/db/types'
import { isDeferredToolOutput } from '@shared/ai/transport'
import { DataApiErrorFactory } from '@shared/data/api/errors'

const SQLITE_INARRAY_CHUNK = 500

export function hydrateAgentSessionMessageDataTx<T extends AgentSessionMessageRow['data']>(
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

export function hydrateAgentSessionMessageRowsTx<T extends { id: string; data: AgentSessionMessageRow['data'] }>(
  db: DbOrTx,
  rows: T[]
): T[] {
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
      data: { parts: [] },
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
    orderAgentSessionPath(rows, selected).filter((row) => row.role !== 'root')
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
