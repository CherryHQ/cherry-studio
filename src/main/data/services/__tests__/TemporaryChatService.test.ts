import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { TemporaryChatService } from '@data/services/TemporaryChatService'
import { BlockType, type MessageData } from '@shared/data/types/message'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

function fieldsOf(err: unknown): Record<string, string[]> {
  const details = (err as { details?: { fieldErrors?: Record<string, string[]> } }).details
  return details?.fieldErrors ?? {}
}

function mainText(content: string): MessageData {
  return { blocks: [{ type: BlockType.MAIN_TEXT, content, createdAt: 0 }] }
}

describe('TemporaryChatService', () => {
  const dbh = setupTestDatabase()
  let service: TemporaryChatService

  beforeEach(() => {
    service = new TemporaryChatService()
  })

  describe('createTopic — input validation', () => {
    it('rejects sourceNodeId (fork not supported)', async () => {
      const err = await service.createTopic({ sourceNodeId: 'some-msg-id' }).catch((e) => e)
      expect(fieldsOf(err).sourceNodeId).toBeDefined()
    })
  })

  describe('appendMessage — input validation', () => {
    let topicId: string
    beforeEach(async () => {
      const topic = await service.createTopic({ name: 'T' })
      topicId = topic.id
    })

    it('rejects parentId', async () => {
      const err = await service
        .appendMessage(topicId, { role: 'user', data: mainText('hi'), parentId: 'some-msg' })
        .catch((e) => e)
      expect(fieldsOf(err).parentId).toBeDefined()
    })

    it('rejects non-zero siblingsGroupId', async () => {
      const err = await service
        .appendMessage(topicId, { role: 'user', data: mainText('hi'), siblingsGroupId: 1 })
        .catch((e) => e)
      expect(fieldsOf(err).siblingsGroupId).toBeDefined()
    })

    it('accepts siblingsGroupId === 0', async () => {
      await expect(
        service.appendMessage(topicId, { role: 'user', data: mainText('hi'), siblingsGroupId: 0 })
      ).resolves.toBeDefined()
    })

    it('rejects setAsActive', async () => {
      const err = await service
        .appendMessage(topicId, { role: 'user', data: mainText('hi'), setAsActive: true })
        .catch((e) => e)
      expect(fieldsOf(err).setAsActive).toBeDefined()
    })

    it('rejects status=pending', async () => {
      const err = await service
        .appendMessage(topicId, { role: 'user', data: mainText('hi'), status: 'pending' })
        .catch((e) => e)
      expect(fieldsOf(err).status).toBeDefined()
    })

    it('rejects unknown role', async () => {
      const err = await service.appendMessage(topicId, { role: 'bogus' as never, data: mainText('hi') }).catch((e) => e)
      expect(fieldsOf(err).role).toBeDefined()
    })

    it('rejects append to unknown topicId with notFound', async () => {
      await expect(service.appendMessage('no-such-topic', { role: 'user', data: mainText('hi') })).rejects.toThrow(
        /not found/i
      )
    })
  })

  describe('deleteTopic / listMessages — notFound', () => {
    it('deleteTopic on unknown id throws notFound', async () => {
      await expect(service.deleteTopic('missing')).rejects.toThrow(/not found/i)
    })

    it('listMessages on unknown id throws notFound', async () => {
      await expect(service.listMessages('missing')).rejects.toThrow(/not found/i)
    })
  })

  describe('return shape', () => {
    it('createTopic returns Topic with activeNodeId=null and ISO timestamps', async () => {
      // Note: we do NOT set assistantId here because FK enforcement is ON
      // and the assistant table starts empty.
      const topic = await service.createTopic({ name: 'hello' })
      expect(topic.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(topic.name).toBe('hello')
      expect(topic.activeNodeId).toBeNull()
      expect(topic.orderKey).toBe('')
      expect(typeof topic.createdAt).toBe('string')
      expect(new Date(topic.createdAt).getTime()).toBeGreaterThan(0)
    })

    it('appendMessage returns Message with parentId=null, siblingsGroupId=0, searchableText=null', async () => {
      const topic = await service.createTopic({ name: 'T' })
      const snapshot = { id: 'mdl-1', name: 'GPT', provider: 'openai' }
      const msg = await service.appendMessage(topic.id, {
        role: 'assistant',
        data: mainText('world'),
        modelId: 'mdl-1',
        modelSnapshot: snapshot,
        traceId: 'trace-1',
        stats: { totalTokens: 42 }
      })
      expect(msg.parentId).toBeNull()
      expect(msg.siblingsGroupId).toBe(0)
      expect(msg.searchableText).toBeNull()
      expect(msg.topicId).toBe(topic.id)
      expect(msg.modelId).toBe('mdl-1')
      expect(msg.modelSnapshot).toEqual(snapshot)
      expect(msg.traceId).toBe('trace-1')
      expect(msg.stats).toEqual({ totalTokens: 42 })
      expect(typeof msg.createdAt).toBe('string')
    })
  })

  describe('listMessages — deep-clone isolation', () => {
    it('mutating the returned array does not affect internal store', async () => {
      const topic = await service.createTopic({ name: 'T' })
      await service.appendMessage(topic.id, { role: 'user', data: mainText('a') })
      const list1 = await service.listMessages(topic.id)
      list1.push({ ...list1[0], id: 'external' })
      const list2 = await service.listMessages(topic.id)
      expect(list2).toHaveLength(1)
    })

    it('mutating nested data on the returned array does not affect store', async () => {
      const topic = await service.createTopic({ name: 'T' })
      await service.appendMessage(topic.id, { role: 'user', data: mainText('a') })
      const list1 = await service.listMessages(topic.id)
      expect(list1).toHaveLength(1)
      const block = list1[0].data.blocks![0]
      if (block.type === BlockType.MAIN_TEXT) block.content = 'mutated'
      const list2 = await service.listMessages(topic.id)
      expect(list2).toHaveLength(1)
      const fresh = list2[0].data.blocks![0]
      expect(fresh.type).toBe(BlockType.MAIN_TEXT)
      if (fresh.type === BlockType.MAIN_TEXT) {
        expect(fresh.content).toBe('a')
      }
    })
  })

  describe('persist', () => {
    it('happy path: writes topic + messages, linearizes parentId chain, sets activeNodeId, clears store', async () => {
      const topic = await service.createTopic({ name: 'persisted' })
      const m1 = await service.appendMessage(topic.id, { role: 'user', data: mainText('hi') })
      const m2 = await service.appendMessage(topic.id, { role: 'assistant', data: mainText('yo') })
      const m3 = await service.appendMessage(topic.id, { role: 'user', data: mainText('again') })

      const result = await service.persist(topic.id)
      expect(result).toEqual({ topicId: topic.id, messageCount: 3 })

      // In-memory store is cleared
      await expect(service.listMessages(topic.id)).rejects.toThrow(/not found/i)
      await expect(service.deleteTopic(topic.id)).rejects.toThrow(/not found/i)

      // Persistent DB contains the topic with correct activeNodeId
      const [dbTopic] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, topic.id)).limit(1)
      expect(dbTopic?.activeNodeId).toBe(m3.id)
      expect(dbTopic?.name).toBe('persisted')

      // Messages form a linear chain m1 <- m2 <- m3
      const rows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, topic.id))
      const byId = new Map(rows.map((r) => [r.id, r]))
      expect(byId.get(m1.id)?.parentId).toBeNull()
      expect(byId.get(m2.id)?.parentId).toBe(m1.id)
      expect(byId.get(m3.id)?.parentId).toBe(m2.id)
      expect(rows.every((r) => r.siblingsGroupId === 0)).toBe(true)
    })

    it('empty session: persists topic with activeNodeId=null', async () => {
      const topic = await service.createTopic({ name: 'empty' })
      const result = await service.persist(topic.id)
      expect(result.messageCount).toBe(0)
      const [dbTopic] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, topic.id)).limit(1)
      expect(dbTopic?.activeNodeId).toBeNull()
    })

    it('unknown topicId → notFound', async () => {
      await expect(service.persist('no-such-id')).rejects.toThrow(/not found/i)
    })

    // NOTE: The original "rollback on tx failure" test dropped the message
    // table mid-run. That would corrupt the shared schema for all subsequent
    // tests in the harness. We drop this specific scenario — the rollback
    // semantics are better exercised by the handler-layer integration test
    // that uses a fresh tmpdir per case.
  })
})
