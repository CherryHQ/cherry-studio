/**
 * Integration test: full temporary-chat → persist → persistent-readback flow.
 *
 * After persist writes into the real DB, the persistent `messageService.getTree`
 * must read it back as a correctly-linearized tree with activeNodeId set to
 * the last message and FTS5 `searchable_text` auto-populated by triggers.
 *
 * Uses the unified setupTestDatabase() harness, which mirrors production's
 * DbService.onInit: real migrations + CUSTOM_SQL_STATEMENTS (FTS5 + triggers).
 */

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { messageTable } from '@data/db/schemas/message'
import { messageService } from '@data/services/MessageService'
import { temporaryChatService } from '@data/services/TemporaryChatService'
import type { MessageData } from '@shared/data/types/message'

function mainText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] }
}

describe('Temporary Chat end-to-end (persist → persistent readback)', () => {
  const dbh = setupTestDatabase()

  it('persist promotes a temp chat into a persistent topic readable by messageService', async () => {
    // 1. Create a temporary topic. We omit assistantId because FK enforcement
    // is ON and the assistant table starts empty; the persist flow does not
    // require an assistant FK to be set.
    const topic = temporaryChatService.createTopic({ name: 'Quick question' })
    expect(topic.activeNodeId).toBeUndefined()
    expect(topic.id).toMatch(/^[0-9a-f-]{36}$/)

    // 2. Append 4 messages: user / assistant / user / assistant.
    const m1 = temporaryChatService.appendMessage(topic.id, { role: 'user', data: mainText('hi there') })
    const m2 = temporaryChatService.appendMessage(topic.id, { role: 'assistant', data: mainText('hello back') })
    const m3 = temporaryChatService.appendMessage(topic.id, { role: 'user', data: mainText('second question') })
    const m4 = temporaryChatService.appendMessage(topic.id, { role: 'assistant', data: mainText('second answer') })

    // 3. Sanity-check in-memory ordering.
    const listed = temporaryChatService.listMessages(topic.id)
    expect(listed.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id, m4.id])

    // 4. Persist. The returned topicId must equal the temporary id unchanged.
    const persistResult = temporaryChatService.persist(topic.id)
    expect(persistResult).toEqual({ topicId: topic.id, messageCount: 4 })

    // 5. After persist, the in-memory store is cleared.
    expect(() => temporaryChatService.listMessages(topic.id)).toThrow(/not found/i)

    // 6. The persistent messageService reads the topic as a linear tree with
    // activeNodeId pointing at the last message.
    const tree = messageService.getTree(topic.id)
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
    // The extra row is the structural virtual root (parentId === null, no content);
    // filter to content rows before asserting count and searchable_text.
    const rows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, topic.id))
    const contentRows = rows.filter((r) => r.parentId !== null)
    expect(contentRows).toHaveLength(4)
    for (const r of contentRows) {
      expect(r.searchableText).toBeTruthy()
    }

    // And FTS full-text search actually works.
    const ftsMatches = dbh.sqlite
      .prepare(`SELECT m.id FROM message m JOIN message_fts fts ON m.fts_rowid = fts.rowid WHERE message_fts MATCH ?`)
      .all('second') as Array<{ id: string }>
    const ftsIds = new Set(ftsMatches.map((r) => String(r.id)))
    expect(ftsIds.has(m3.id)).toBe(true)
    expect(ftsIds.has(m4.id)).toBe(true)
    expect(ftsIds.has(m1.id)).toBe(false)
  })
})
