import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { TemporaryChatService } from '@data/services/TemporaryChatService'
import type { MessageData } from '@shared/data/types/message'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function fieldsOf(err: unknown): Record<string, string[]> {
  const details = (err as { details?: { fieldErrors?: Record<string, string[]> } }).details
  return details?.fieldErrors ?? {}
}

function mainText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] }
}

describe('TemporaryChatService', () => {
  const dbh = setupTestDatabase()
  let service: TemporaryChatService

  beforeEach(() => {
    service = new TemporaryChatService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('appendMessage — input validation', () => {
    let topicId: string
    beforeEach(async () => {
      const topic = service.createTopic({ name: 'T' })
      topicId = topic.id
    })

    it('rejects parentId', () => {
      let err: unknown
      try {
        service.appendMessage(topicId, { role: 'user', data: mainText('hi'), parentId: 'some-msg' })
      } catch (e) {
        err = e
      }
      expect(fieldsOf(err).parentId).toBeDefined()
    })

    it('rejects non-zero siblingsGroupId', () => {
      let err: unknown
      try {
        service.appendMessage(topicId, { role: 'user', data: mainText('hi'), siblingsGroupId: 1 })
      } catch (e) {
        err = e
      }
      expect(fieldsOf(err).siblingsGroupId).toBeDefined()
    })

    it('accepts siblingsGroupId === 0', () => {
      expect(service.appendMessage(topicId, { role: 'user', data: mainText('hi'), siblingsGroupId: 0 })).toBeDefined()
    })

    it('rejects setAsActive', () => {
      let err: unknown
      try {
        service.appendMessage(topicId, { role: 'user', data: mainText('hi'), setAsActive: true })
      } catch (e) {
        err = e
      }
      expect(fieldsOf(err).setAsActive).toBeDefined()
    })

    it('rejects status=pending', () => {
      let err: unknown
      try {
        service.appendMessage(topicId, { role: 'user', data: mainText('hi'), status: 'pending' })
      } catch (e) {
        err = e
      }
      expect(fieldsOf(err).status).toBeDefined()
    })

    it('rejects unknown role', () => {
      let err: unknown
      try {
        service.appendMessage(topicId, { role: 'bogus' as never, data: mainText('hi') })
      } catch (e) {
        err = e
      }
      expect(fieldsOf(err).role).toBeDefined()
    })

    it('rejects append to unknown topicId with notFound', () => {
      expect(() => service.appendMessage('no-such-topic', { role: 'user', data: mainText('hi') })).toThrow(/not found/i)
    })
  })

  describe('deleteTopic / listMessages — notFound', () => {
    it('deleteTopic on unknown id throws notFound', () => {
      expect(() => service.deleteTopic('missing')).toThrow(/not found/i)
    })

    it('listMessages on unknown id throws notFound', () => {
      expect(() => service.listMessages('missing')).toThrow(/not found/i)
    })
  })

  describe('return shape', () => {
    it('createTopic returns Topic with activeNodeId=null and ISO timestamps', async () => {
      // Note: we do NOT set assistantId here because FK enforcement is ON
      // and the assistant table starts empty.
      const topic = service.createTopic({ name: 'hello' })
      expect(topic.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(topic.name).toBe('hello')
      expect(topic.activeNodeId).toBeUndefined()
      expect(topic.orderKey).toBe('')
      expect(typeof topic.createdAt).toBe('string')
      expect(new Date(topic.createdAt).getTime()).toBeGreaterThan(0)
    })

    it('appendMessage returns Message with parentId=null, siblingsGroupId=0, searchableText=""', async () => {
      const topic = service.createTopic({ name: 'T' })
      const snapshot = {
        id: 'a1',
        name: 'GPT Assistant',
        emoji: '🤖',
        model: { id: 'mdl-1', name: 'GPT', provider: 'openai' }
      }
      const msg = service.appendMessage(topic.id, {
        role: 'assistant',
        data: mainText('world'),
        modelId: 'mdl-1',
        messageSnapshot: snapshot,
        stats: { totalTokens: 42 }
      })
      expect(msg.parentId).toBeNull()
      expect(msg.siblingsGroupId).toBe(0)
      expect(msg.searchableText).toBe('')
      expect(msg.topicId).toBe(topic.id)
      expect(msg.modelId).toBe('mdl-1')
      expect(msg.messageSnapshot).toEqual(snapshot)
      expect(msg.stats).toEqual({ totalTokens: 42 })
      expect(typeof msg.createdAt).toBe('string')
    })
  })

  describe('listMessages — deep-clone isolation', () => {
    it('mutating the returned array does not affect internal store', async () => {
      const topic = service.createTopic({ name: 'T' })
      service.appendMessage(topic.id, { role: 'user', data: mainText('a') })
      const list1 = service.listMessages(topic.id)
      list1.push({ ...list1[0], id: 'external' })
      const list2 = service.listMessages(topic.id)
      expect(list2).toHaveLength(1)
    })

    it('mutating nested data on the returned array does not affect store', async () => {
      const topic = service.createTopic({ name: 'T' })
      service.appendMessage(topic.id, { role: 'user', data: mainText('a') })
      const list1 = service.listMessages(topic.id)
      expect(list1).toHaveLength(1)
      const part = list1[0].data.parts![0]
      if (part.type === 'text') part.text = 'mutated'
      const list2 = service.listMessages(topic.id)
      expect(list2).toHaveLength(1)
      const fresh = list2[0].data.parts![0]
      expect(fresh.type).toBe('text')
      if (fresh.type === 'text') {
        expect(fresh.text).toBe('a')
      }
    })
  })

  describe('persist', () => {
    it('happy path: writes topic + messages, linearizes parentId chain, sets activeNodeId, clears store', async () => {
      const topic = service.createTopic({ name: 'persisted' })
      const m1 = service.appendMessage(topic.id, { role: 'user', data: mainText('hi') })
      const m2 = service.appendMessage(topic.id, { role: 'assistant', data: mainText('yo') })
      const m3 = service.appendMessage(topic.id, { role: 'user', data: mainText('again') })

      const result = service.persist(topic.id)
      expect(result).toEqual({ topicId: topic.id, messageCount: 3 })

      // In-memory store is cleared
      expect(() => service.listMessages(topic.id)).toThrow(/not found/i)
      expect(() => service.deleteTopic(topic.id)).toThrow(/not found/i)

      // Persistent DB contains the topic with correct activeNodeId
      const [dbTopic] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, topic.id)).limit(1)
      expect(dbTopic?.activeNodeId).toBe(m3.id)
      expect(dbTopic?.name).toBe('persisted')

      // Messages form a linear chain root <- m1 <- m2 <- m3, with the first message
      // hanging off the topic's virtual root (the single parentId-null row).
      const rows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, topic.id))
      const byId = new Map(rows.map((r) => [r.id, r]))
      const virtualRoot = rows.find((r) => r.parentId === null)
      expect(virtualRoot?.role).toBe('root')
      expect(byId.get(m1.id)?.parentId).toBe(virtualRoot?.id)
      expect(byId.get(m2.id)?.parentId).toBe(m1.id)
      expect(byId.get(m3.id)?.parentId).toBe(m2.id)
      expect(rows.every((r) => r.siblingsGroupId === 0)).toBe(true)
    })

    it('empty session: persists topic with activeNodeId=null', async () => {
      const topic = service.createTopic({ name: 'empty' })
      const result = service.persist(topic.id)
      expect(result.messageCount).toBe(0)
      const [dbTopic] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, topic.id)).limit(1)
      expect(dbTopic?.activeNodeId).toBeNull()
    })

    it('preserves creation and response-completion activity timestamps across persistence', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      const topic = service.createTopic({ name: 'timestamped' })
      vi.setSystemTime(new Date('2026-01-01T00:01:00.000Z'))
      const user = service.appendMessage(topic.id, { role: 'user', data: mainText('hi') })
      vi.setSystemTime(new Date('2026-01-01T00:02:00.000Z'))
      const assistant = service.appendMessage(topic.id, { role: 'assistant', data: mainText('hello') })
      vi.setSystemTime(new Date('2026-01-01T00:03:00.000Z'))

      service.persist(topic.id)

      const [dbTopic] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, topic.id)).limit(1)
      const rows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, topic.id))
      const byId = new Map(rows.map((row) => [row.id, row]))
      expect(dbTopic?.createdAt).toBe(Date.parse(topic.createdAt))
      expect(byId.get(user.id)?.createdAt).toBe(Date.parse(user.createdAt))
      expect(byId.get(assistant.id)?.createdAt).toBe(Date.parse(assistant.createdAt))
      expect(byId.get(assistant.id)?.terminalAt).toBe(Date.parse(assistant.createdAt))
      expect(dbTopic?.lastActivityAt).toBe(Date.parse(assistant.createdAt))
    })

    it('unknown topicId → notFound', () => {
      expect(() => service.persist('no-such-id')).toThrow(/not found/i)
    })

    it('persisted topic has a non-empty fractional-indexing orderKey', async () => {
      // Regression guard: a refactor swapping insertWithOrderKey for plain
      // tx.insert() would ship the row with orderKey = '' — silently breaks
      // all subsequent reorders and the unpinned section's sort.
      const topic = service.createTopic({ name: 'with-key' })
      service.persist(topic.id)
      const [dbTopic] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, topic.id)).limit(1)
      expect(dbTopic?.orderKey).toBeDefined()
      expect(dbTopic?.orderKey).not.toBe('')
      expect(dbTopic?.orderKey?.length).toBeGreaterThan(0)
    })

    // NOTE: The original "rollback on tx failure" test dropped the message
    // table mid-run. That would corrupt the shared schema for all subsequent
    // tests in the harness. We drop this specific scenario — the rollback
    // semantics are better exercised by the handler-layer integration test
    // that uses a fresh tmpdir per case.
  })
})
