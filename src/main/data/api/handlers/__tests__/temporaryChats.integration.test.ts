/**
 * Integration test: full temporary-chat → persist → persistent-readback flow.
 *
 * Covers the unique end-to-end value that handler mock tests cannot: after
 * persist writes into the real DB, the persistent `messageService.getTree`
 * must read it back as a correctly-linearized tree with activeNodeId set to
 * the last message and FTS5 `searchable_text` auto-populated by triggers.
 *
 * Uses the unified setupTestDatabase() harness, which mirrors production's
 * DbService.onInit: real migrations + CUSTOM_SQL_STATEMENTS (FTS5 + triggers).
 */

import { temporaryChatHandlers } from '@data/api/handlers/temporaryChats'
import { messageTable } from '@data/db/schemas/message'
import { messageService } from '@data/services/MessageService'
import type { PersistTemporaryChatResponse } from '@shared/data/api/schemas/temporaryChats'
import { BlockType, type Message, type MessageData } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

function mainText(content: string): MessageData {
  return { blocks: [{ type: BlockType.MAIN_TEXT, content, createdAt: 0 }] }
}

describe('Temporary Chat end-to-end (handler → persist → persistent readback)', () => {
  const dbh = setupTestDatabase()

  // Minimal request envelope; only the fields each handler destructures matter.
  const req = <T extends object>(parts: T): any => ({
    ...parts,
    headers: {},
    requestId: 'rid',
    path: '/temporary/...'
  })

  // Handlers return `T | { data: T; status }`.
  const unwrap = <T>(result: unknown): T => {
    if (
      result &&
      typeof result === 'object' &&
      'data' in result &&
      'status' in result &&
      typeof (result as { status: unknown }).status === 'number'
    ) {
      return (result as { data: T }).data
    }
    return result as T
  }

  it('persist promotes a temp chat into a persistent topic readable by messageService', async () => {
    // 1. Create a temporary topic. We omit assistantId because FK enforcement
    // is ON and the assistant table starts empty; the persist flow does not
    // require an assistant FK to be set.
    const topic = unwrap<Topic>(
      await temporaryChatHandlers['/temporary/topics'].POST(req({ body: { name: 'Quick question' } }))
    )
    expect(topic.activeNodeId).toBeUndefined()
    expect(topic.id).toMatch(/^[0-9a-f-]{36}$/)

    // 2. Append 4 messages: user / assistant / user / assistant.
    const m1 = unwrap<Message>(
      await temporaryChatHandlers['/temporary/topics/:topicId/messages'].POST(
        req({ params: { topicId: topic.id }, body: { role: 'user', data: mainText('hi there') } })
      )
    )
    const m2 = unwrap<Message>(
      await temporaryChatHandlers['/temporary/topics/:topicId/messages'].POST(
        req({ params: { topicId: topic.id }, body: { role: 'assistant', data: mainText('hello back') } })
      )
    )
    const m3 = unwrap<Message>(
      await temporaryChatHandlers['/temporary/topics/:topicId/messages'].POST(
        req({ params: { topicId: topic.id }, body: { role: 'user', data: mainText('second question') } })
      )
    )
    const m4 = unwrap<Message>(
      await temporaryChatHandlers['/temporary/topics/:topicId/messages'].POST(
        req({ params: { topicId: topic.id }, body: { role: 'assistant', data: mainText('second answer') } })
      )
    )

    // 3. List messages via temp handler to sanity-check ordering.
    const listed = unwrap<Message[]>(
      await temporaryChatHandlers['/temporary/topics/:topicId/messages'].GET(req({ params: { topicId: topic.id } }))
    )
    expect(listed.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id, m4.id])

    // 4. Persist. The returned topicId must equal the temporary id unchanged.
    const persistResult = unwrap<PersistTemporaryChatResponse>(
      await temporaryChatHandlers['/temporary/topics/:id/persist'].POST(req({ params: { id: topic.id } }))
    )
    expect(persistResult).toEqual({ topicId: topic.id, messageCount: 4 })

    // 5. After persist, the in-memory store is cleared — temp handlers see 404.
    await expect(
      temporaryChatHandlers['/temporary/topics/:topicId/messages'].GET(req({ params: { topicId: topic.id } }))
    ).rejects.toThrow(/not found/i)

    // 6. The persistent messageService reads the topic as a linear tree with
    // activeNodeId pointing at the last message.
    const tree = await messageService.getTree(topic.id, { depth: -1 })
    expect(tree.activeNodeId).toBe(m4.id)
    expect(tree.siblingsGroups).toEqual([])
    const ids = tree.nodes.map((n) => n.id)
    expect(ids).toEqual([m1.id, m2.id, m3.id, m4.id])
    const byId = new Map(tree.nodes.map((n) => [n.id, n]))
    expect(byId.get(m1.id)!.hasChildren).toBe(true)
    expect(byId.get(m2.id)!.hasChildren).toBe(true)
    expect(byId.get(m3.id)!.hasChildren).toBe(true)
    expect(byId.get(m4.id)!.hasChildren).toBe(false)

    // 7. FTS5 trigger must have populated searchable_text for every message.
    const rows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, topic.id))
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r.searchableText).toBeTruthy()
    }

    // And FTS full-text search actually works.
    const ftsMatches = await dbh.client.execute({
      sql: `SELECT m.id FROM message m JOIN message_fts fts ON m.rowid = fts.rowid WHERE message_fts MATCH ?`,
      args: ['second']
    })
    const ftsIds = new Set(ftsMatches.rows.map((r) => String(r[0])))
    expect(ftsIds.has(m3.id)).toBe(true)
    expect(ftsIds.has(m4.id)).toBe(true)
    expect(ftsIds.has(m1.id)).toBe(false)
  })
})
