import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { messageService } from '@data/services/MessageService'
import { TemporaryChatService } from '@main/ai/TemporaryChatService'
import { BaseService } from '@main/core/lifecycle'
import type { MessageData } from '@shared/data/types/message'

function mainText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] }
}

describe('Temporary conversation promotion', () => {
  const dbh = setupTestDatabase()
  let service: TemporaryChatService
  beforeEach(() => {
    BaseService.resetInstances()
    service = new TemporaryChatService()
    const container = application.getContainer()
    vi.mocked(application.get).mockImplementation((name: string) =>
      name === 'TemporaryChatService' ? service : container.get(name)
    )
  })

  it('preserves message identities, linear history, active node and full-text search', async () => {
    const topic = service.createTopic({ name: 'Quick question' })
    const m1 = await service.appendMessage(topic.id, { role: 'user', data: mainText('hi there') })
    const m2 = await service.appendMessage(topic.id, { role: 'assistant', data: mainText('hello back') })
    const m3 = await service.appendMessage(topic.id, { role: 'user', data: mainText('second question') })
    const m4 = await service.appendMessage(topic.id, { role: 'assistant', data: mainText('second answer') })

    expect(await service.persist(topic.id)).toEqual({ topicId: topic.id, messageCount: 4 })
    expect(service.hasTopic(topic.id)).toBe(false)
    const tree = messageService.getTree(topic.id, { depth: -1 })
    expect(tree.activeNodeId).toBe(m4.id)
    expect(tree.siblingsGroups).toEqual([])
    expect(tree.nodes.map((n) => n.id)).toEqual([m1.id, m2.id, m3.id, m4.id])
    expect(tree.nodes.map((n) => n.hasChildren)).toEqual([true, true, true, false])
    const rows = dbh.db.select().from(messageTable).where(eq(messageTable.topicId, topic.id)).all()
    const contentRows = rows.filter((r) => r.parentId !== null)
    expect(contentRows).toHaveLength(4)
    for (const row of contentRows) expect(row.searchableText).toBeTruthy()
    const matches = dbh.sqlite
      .prepare('SELECT m.id FROM message m JOIN message_fts fts ON m.fts_rowid = fts.rowid WHERE message_fts MATCH ?')
      .all('second') as Array<{ id: string }>
    expect(new Set(matches.map((row) => row.id))).toEqual(new Set([m3.id, m4.id]))
  })

  it('rolls back the topic and earlier messages if a later message cannot be inserted', async () => {
    const topic = service.createTopic({})
    await service.appendMessage(topic.id, { role: 'user', data: mainText('first') }, 'duplicate')
    await service.appendMessage(topic.id, { role: 'assistant', data: mainText('second') }, 'duplicate')
    await expect(service.persist(topic.id)).rejects.toThrow()
    expect(dbh.db.select().from(topicTable).all()).toEqual([])
    expect(dbh.db.select().from(messageTable).all()).toEqual([])
    expect(service.listMessages(topic.id)).toHaveLength(2)
  })
})
