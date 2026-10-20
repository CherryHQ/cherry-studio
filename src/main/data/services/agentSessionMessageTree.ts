import { and, eq, inArray, sql } from 'drizzle-orm'

import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable as messages } from '@data/db/schemas/agentSessionMessage'
import type { DbOrTx } from '@data/db/types'
import { DataApiErrorFactory } from '@shared/data/api/errors'

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
  return orderPath(rows, selected).filter((row) => row.role !== 'root')
}

export function readAgentSessionAncestry(db: DbOrTx, sessionId: string, head: string) {
  const rows = db
    .select({ id: messages.id, parentId: messages.parentId })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), inArray(messages.id, agentSessionPathIds(sessionId, head))))
    .all()
  return orderPath(rows, head)
}

function orderPath<T extends { id: string; parentId: string | null }>(rows: T[], selected: string): T[] {
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
