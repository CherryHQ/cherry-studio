import { messageTable } from '@data/db/schemas/message'

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
