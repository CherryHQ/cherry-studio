import { and, eq, sql } from 'drizzle-orm'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { messageTable } from '@data/db/schemas/message'
import type { DbType } from '@data/db/types'

type InsertMessageRow = typeof messageTable.$inferInsert

/**
 * Virtual-root sentinel for a topic: the single `parentId = null` row. Content-less
 * (`role = 'root'`, empty `data`), never rendered or included in history; every
 * content message hangs below it. Mirrors `MessageService.createRootMessageTx`.
 * Uses a deterministic `vroot-<topicId>` id so tests can assert on it.
 */
export function rootRow(topicId: string): InsertMessageRow {
  return {
    id: `vroot-${topicId}`,
    parentId: null,
    topicId,
    role: 'root',
    data: { parts: [] },
    status: 'success',
    siblingsGroupId: 0,
    createdAt: 1,
    updatedAt: 1
  }
}

/**
 * Seed helper for the virtual-root message model: prepend the topic's virtual root and
 * reparent any former roots (`parentId == null`) onto it. Lets a test author a conversation
 * with `parentId: null` for the first turn and have it land as a child of the virtual root.
 */
export function withRoot(topicId: string, messages: InsertMessageRow[]): InsertMessageRow[] {
  const id = `vroot-${topicId}`
  return [rootRow(topicId), ...messages.map((m) => (m.parentId == null ? { ...m, parentId: id } : m))]
}

/** Create a root for direct SQL fixtures without changing the selected head or session timestamps. */
export function seedSessionRoot(db: DbType, sessionId: string): string {
  const existing = db
    .select({ id: agentSessionMessageTable.id })
    .from(agentSessionMessageTable)
    .where(and(eq(agentSessionMessageTable.sessionId, sessionId), eq(agentSessionMessageTable.role, 'root')))
    .get()
  if (existing) return existing.id
  return db
    .insert(agentSessionMessageTable)
    .values({ sessionId, role: 'root', data: { parts: [] }, status: 'success', createdAt: 1, updatedAt: 1 })
    .returning({ id: agentSessionMessageTable.id })
    .get().id
}

/** Link fixture rows in the given order and select the last row without changing timestamps. */
export function linkSessionMessageChain(db: DbType, sessionId: string, messageIds: readonly string[]): void {
  let parentId = seedSessionRoot(db, sessionId)
  for (const id of messageIds) {
    db.update(agentSessionMessageTable)
      .set({ parentId, updatedAt: sql`${agentSessionMessageTable.updatedAt}` })
      .where(and(eq(agentSessionMessageTable.sessionId, sessionId), eq(agentSessionMessageTable.id, id)))
      .run()
    parentId = id
  }
  db.update(agentSessionTable)
    .set({ activeNodeId: parentId, updatedAt: sql`${agentSessionTable.updatedAt}` })
    .where(eq(agentSessionTable.id, sessionId))
    .run()
}
