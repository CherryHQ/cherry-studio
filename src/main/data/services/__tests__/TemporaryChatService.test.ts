import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { TemporaryChatService } from '@data/services/TemporaryChatService'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

import type { MessageData } from '@shared/data/types/message'

function fieldsOf(err: unknown): Record<string, string[]> {
  const details = (err as { details?: { fieldErrors?: Record<string, string[]> } }).details
  return details?.fieldErrors ?? {}
}

function mainText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] }
}

function attachmentData(fileEntryId: string): MessageData {
  const part = {
    type: 'file' as const,
    mediaType: 'text/plain',
    url: `file:///tmp/${fileEntryId}.txt`,
    filename: 'attachment.txt',
    providerMetadata: { cherry: { fileEntryId } }
  }
  return { parts: [part, part] }
}

function toolOutputData(fileEntryId: string): MessageData {
  return {
    parts: [
      {
        type: 'tool-run_cmd',
        toolCallId: 'call-1',
        state: 'output-available',
        input: {},
        output: {
          $persistedToolOutput: {
            shape: 'text',
            fileEntryId,
            vfsFilename: 'vfs_0123456789abcdef.txt',
            head: 'head',
            tail: 'tail',
            totalChars: 200_000,
            totalLines: 5_000
          }
        }
      }
    ]
  }
}

describe('TemporaryChatService', () => {
  const dbh = setupTestDatabase()
  let service: TemporaryChatService

  beforeEach(() => {
    service = new TemporaryChatService()
    notifyDataApiDataChangeMock.mockClear()
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
        messageSnapshot: snapshot
      })
      expect(msg.parentId).toBeNull()
      expect(msg.siblingsGroupId).toBe(0)
      expect(msg.searchableText).toBe('')
      expect(msg.topicId).toBe(topic.id)
      expect(msg.modelId).toBe('mdl-1')
      expect(msg.messageSnapshot).toEqual(snapshot)
      expect(msg.stats).toBeNull()
      expect(typeof msg.createdAt).toBe('string')
    })

    it('uses a caller-provided stable message id', () => {
      const topic = service.createTopic({ name: 'T' })
      const msg = service.appendMessage(
        topic.id,
        { role: 'assistant', data: mainText('world') },
        'assistant-message-id'
      )

      expect(msg.id).toBe('assistant-message-id')
      expect(service.listMessages(topic.id)[0].id).toBe('assistant-message-id')
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
    describe('file references', () => {
      const firstFileId = '019606a0-0000-7000-8000-00000000fc01'
      const secondFileId = '019606a0-0000-7000-8000-00000000fc02'

      beforeEach(async () => {
        await dbh.db.insert(fileEntryTable).values(
          [firstFileId, secondFileId].map((id) => ({
            id,
            origin: 'internal',
            name: 'attachment',
            ext: 'txt',
            size: 1,
            cleanupPolicy: 'delete_when_unreferenced'
          }))
        )
      })

      it('saves one attachment reference per file while preserving message content and timestamps', () => {
        const topic = service.createTopic({ name: 'attachments' })
        const message = service.appendMessage(topic.id, { role: 'user', data: attachmentData(firstFileId) })

        service.persist(topic.id)

        const refs = dbh.db.select().from(chatMessageFileRefTable).all()
        expect(refs).toHaveLength(1)
        expect(refs[0]).toMatchObject({ sourceId: message.id, fileEntryId: firstFileId, role: 'attachment' })
        expect(dbh.db.select().from(messageTable).where(eq(messageTable.id, message.id)).get()).toMatchObject({
          topicId: topic.id,
          data: message.data,
          status: message.status,
          createdAt: Date.parse(message.createdAt),
          updatedAt: Date.parse(message.updatedAt)
        })
      })

      it('saves tool-output references independently from attachments to the same file', () => {
        const topic = service.createTopic({ name: 'tool outputs' })
        const user = service.appendMessage(topic.id, { role: 'user', data: attachmentData(firstFileId) })
        const assistant = service.appendMessage(topic.id, { role: 'assistant', data: toolOutputData(firstFileId) })

        service.persist(topic.id)

        expect(
          dbh.db
            .select({ sourceId: chatMessageFileRefTable.sourceId, role: chatMessageFileRefTable.role })
            .from(chatMessageFileRefTable)
            .where(eq(chatMessageFileRefTable.fileEntryId, firstFileId))
            .all()
        ).toEqual(
          expect.arrayContaining([
            { sourceId: user.id, role: 'attachment' },
            { sourceId: assistant.id, role: 'tool_output' }
          ])
        )
      })

      it('keeps missing-file parts without inserting dangling references', () => {
        const missingId = '019606a0-0000-7000-8000-00000000fc03'
        const topic = service.createTopic({ name: 'missing file' })
        const message = service.appendMessage(topic.id, { role: 'user', data: attachmentData(missingId) })

        service.persist(topic.id)

        expect(dbh.db.select().from(chatMessageFileRefTable).all()).toEqual([])
        expect(dbh.db.select().from(messageTable).where(eq(messageTable.id, message.id)).get()?.data).toEqual(
          message.data
        )
      })

      it('rolls back messages and references on a later reference-write failure and can retry', () => {
        const topic = service.createTopic({ name: 'retry' })
        service.appendMessage(topic.id, { role: 'user', data: attachmentData(firstFileId) })
        service.appendMessage(topic.id, { role: 'assistant', data: toolOutputData(secondFileId) })
        const buffered = service.listMessages(topic.id)
        dbh.sqlite.exec(`
          CREATE TRIGGER fail_temporary_file_ref BEFORE INSERT ON chat_message_file_ref
          WHEN NEW.file_entry_id = '${secondFileId}'
          BEGIN SELECT RAISE(ABORT, 'injected reference-write failure'); END
        `)

        try {
          expect(() => service.persist(topic.id)).toThrow('injected reference-write failure')
          expect(dbh.db.select().from(topicTable).where(eq(topicTable.id, topic.id)).all()).toEqual([])
          expect(dbh.db.select().from(messageTable).all()).toEqual([])
          expect(dbh.db.select().from(chatMessageFileRefTable).all()).toEqual([])
          expect(service.listMessages(topic.id)).toEqual(buffered)
        } finally {
          dbh.sqlite.exec('DROP TRIGGER fail_temporary_file_ref')
        }

        expect(service.persist(topic.id)).toEqual({ topicId: topic.id, messageCount: 2 })
        expect(dbh.db.select().from(chatMessageFileRefTable).all()).toHaveLength(2)
        expect(service.hasTopic(topic.id)).toBe(false)
      })
    })

    it('happy path: writes topic + messages, linearizes parentId chain, sets activeNodeId, clears store', async () => {
      const topic = service.createTopic({ name: 'persisted' })
      const m1 = service.appendMessage(topic.id, { role: 'user', data: mainText('hi') })
      const m2 = service.appendMessage(topic.id, { role: 'assistant', data: mainText('yo') })
      const m3 = service.appendMessage(topic.id, { role: 'user', data: mainText('again') })

      const result = service.persist(topic.id)
      expect(result).toEqual({ topicId: topic.id, messageCount: 3 })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/topics', kind: 'membership', entityIds: [topic.id] },
        { endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt', entityIds: [topic.id] },
        { endpoint: '/topics/:id', entityIds: [topic.id] },
        { endpoint: '/topics/latest' }
      ])

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

    it('unknown topicId → notFound', () => {
      expect(() => service.persist('no-such-id')).toThrow(/not found/i)
    })

    it('rebuilds an assistant projection from an existing invocation without creating another record', async () => {
      // message.modelId is an FK to user_model — seed the chain.
      await dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: 'a0' })
      await dbh.db.insert(userModelTable).values({
        id: 'openai::gpt-4o',
        providerId: 'openai',
        modelId: 'gpt-4o',
        presetModelId: 'gpt-4o',
        name: 'gpt-4o',
        isEnabled: true,
        isHidden: false,
        orderKey: 'a0'
      })

      const topic = service.createTopic({ name: 'billed' })
      service.appendMessage(topic.id, { role: 'user', data: mainText('hi') })
      const assistant = service.appendAssistantMessage(
        topic.id,
        {
          role: 'assistant',
          data: mainText('yo'),
          modelId: 'openai::gpt-4o'
        },
        undefined,
        'assistant-message-id'
      )

      // Simulate the generation-time invocation fact. Promotion only rebuilds
      // the message projection; it does not mutate or duplicate the record.
      await dbh.db.insert(aiUsageRecordTable).values({
        requestId: 'temporary-provider-call',
        recordKind: 'invocation',
        requestCount: 1,
        messageKind: 'chat',
        messageId: assistant.id,
        providerId: 'openai',
        modelId: 'gpt-4o',
        modality: 'language',
        apiKeyAttribution: 'unknown',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        createdAt: Date.now()
      })

      service.persist(topic.id)

      const rows = await dbh.db.select().from(aiUsageRecordTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        requestId: 'temporary-provider-call',
        messageKind: 'chat',
        messageId: assistant.id,
        providerId: 'openai',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15
      })
      expect(dbh.db.select().from(messageTable).where(eq(messageTable.id, assistant.id)).get()?.stats).toMatchObject({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        requestCount: 1
      })
    })

    it('keeps the provider-reported cost when the temporary chat is kept', async () => {
      await dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: 'a0' })
      await dbh.db.insert(userModelTable).values({
        id: 'openai::gpt-4o',
        providerId: 'openai',
        modelId: 'gpt-4o',
        presetModelId: 'gpt-4o',
        name: 'gpt-4o',
        isEnabled: true,
        isHidden: false,
        orderKey: 'a0',
        // Local pricing would compute 3 USD for this usage — the provider billed 0.9.
        pricing: {
          input: { perMillionTokens: 3, currency: 'USD' },
          output: { perMillionTokens: 15, currency: 'USD' }
        }
      })

      const topic = service.createTopic({ name: 'billed-by-provider' })
      const assistant = service.appendAssistantMessage(
        topic.id,
        {
          role: 'assistant',
          data: mainText('yo'),
          modelId: 'openai::gpt-4o'
        },
        undefined,
        'provider-billed-message'
      )

      // Generation-time request record for the same message id.
      await dbh.db.insert(aiUsageRecordTable).values({
        requestId: 'temporary-provider-cost',
        recordKind: 'invocation',
        requestCount: 1,
        messageKind: 'chat',
        messageId: assistant.id,
        providerId: 'openai',
        modelId: 'gpt-4o',
        modality: 'language',
        apiKeyAttribution: 'unknown',
        inputTokens: 1_000_000,
        totalTokens: 1_000_000,
        cost: 0.9,
        costCurrency: 'USD',
        costSource: 'provider',
        createdAt: Date.now()
      })

      service.persist(topic.id)

      const rows = await dbh.db.select().from(aiUsageRecordTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        requestId: 'temporary-provider-cost',
        cost: 0.9,
        costCurrency: 'USD',
        costSource: 'provider'
      })
      expect(dbh.db.select().from(messageTable).where(eq(messageTable.id, assistant.id)).get()?.stats?.costs).toEqual([
        {
          currency: 'USD',
          amount: 0.9,
          providerReportedRequestCount: 1,
          computedRequestCount: 0
        }
      ])
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
