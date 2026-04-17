import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import { BlockType, type MessageData } from '@shared/data/types/message'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why a file-backed temp DB: libsql's `db.transaction()` releases the current
// connection and lazily creates a new one (see pragmaReplay.test.ts). With a
// `file::memory:` URL each connection gets its own isolated in-memory DB, so
// the transaction sees an empty schema. libsql also rejects the SQLite
// shared-cache URI params (`cache=shared`, `mode=memory`, `vfs=memdb`) — only
// `tls` / `authToken` are allowed — so file-backed is the only honest way to
// exercise the real transaction path in unit tests. The temp file lives in
// os.tmpdir() and is removed after each test. We unmock node:fs/os/path
// (globally mocked by tests/main.setup.ts) so real fs ops work.
vi.mock('node:fs', async (importOriginal) => await importOriginal())
vi.mock('node:os', async (importOriginal) => await importOriginal())
vi.mock('node:path', async (importOriginal) => await importOriginal())

const { mkdtempSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

// Helper: extract the fieldErrors map from a DataApiError-shaped thrown value.
function fieldsOf(err: unknown): Record<string, string[]> {
  const details = (err as { details?: { fieldErrors?: Record<string, string[]> } }).details
  return details?.fieldErrors ?? {}
}

function mainText(content: string): MessageData {
  return { blocks: [{ type: BlockType.MAIN_TEXT, content, createdAt: 0 }] }
}

let realDb: DbType | null = null
let closeClient: (() => void) | undefined

vi.mock('@application', () => ({
  application: {
    get: vi.fn(() => ({
      getDb: vi.fn(() => realDb)
    }))
  }
}))

const { TemporaryChatService } = await import('../TemporaryChatService')

async function initializeTables(db: DbType) {
  await db.run(
    sql.raw(`
      CREATE TABLE topic (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT,
        is_name_manually_edited INTEGER DEFAULT 0,
        assistant_id TEXT,
        active_node_id TEXT,
        group_id TEXT,
        sort_order INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        pinned_order INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER,
        deleted_at INTEGER
      )
    `)
  )
  await db.run(
    sql.raw(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY NOT NULL,
        parent_id TEXT,
        topic_id TEXT NOT NULL,
        role TEXT NOT NULL,
        data TEXT NOT NULL,
        searchable_text TEXT,
        status TEXT NOT NULL,
        siblings_group_id INTEGER DEFAULT 0,
        model_id TEXT,
        model_snapshot TEXT,
        trace_id TEXT,
        stats TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted_at INTEGER
      )
    `)
  )
}

describe('TemporaryChatService', () => {
  let service: InstanceType<typeof TemporaryChatService>
  let tmpDir: string | undefined

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cherry-temp-chat-'))
    const client = createClient({ url: `file:${join(tmpDir, 'test.db')}` })
    closeClient = () => client.close()
    realDb = drizzle({ client, casing: 'snake_case' })
    await initializeTables(realDb)
    service = new TemporaryChatService()
  })

  afterEach(() => {
    closeClient?.()
    closeClient = undefined
    realDb = null
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = undefined
    }
  })

  // --------------------------------------------------------------------------
  // Input validation
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Return shape
  // --------------------------------------------------------------------------

  describe('return shape', () => {
    it('createTopic returns Topic with activeNodeId=null and ISO timestamps', async () => {
      const topic = await service.createTopic({ name: 'hello', assistantId: 'asst_1' })
      expect(topic.id).toMatch(/^temp:[0-9a-f-]{36}$/)
      expect(topic.name).toBe('hello')
      expect(topic.assistantId).toBe('asst_1')
      expect(topic.activeNodeId).toBeNull()
      expect(topic.isPinned).toBe(false)
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

  // --------------------------------------------------------------------------
  // listMessages: deep-clone isolation (the unique contribution of unit tests)
  // --------------------------------------------------------------------------

  describe('listMessages — deep-clone isolation', () => {
    it('mutating the returned array does not affect internal store', async () => {
      const topic = await service.createTopic({ name: 'T' })
      await service.appendMessage(topic.id, { role: 'user', data: mainText('a') })
      const list1 = await service.listMessages(topic.id)
      list1.push({ ...list1[0], id: 'external' })
      const list2 = await service.listMessages(topic.id)
      expect(list2).toHaveLength(1) // not 2
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

  // --------------------------------------------------------------------------
  // persist
  // --------------------------------------------------------------------------

  describe('persist', () => {
    it('happy path: writes topic + messages, linearizes parentId chain, sets activeNodeId, clears store', async () => {
      const topic = await service.createTopic({ name: 'persisted', assistantId: 'asst_x' })
      const m1 = await service.appendMessage(topic.id, { role: 'user', data: mainText('hi') })
      const m2 = await service.appendMessage(topic.id, { role: 'assistant', data: mainText('yo') })
      const m3 = await service.appendMessage(topic.id, { role: 'user', data: mainText('again') })

      const result = await service.persist(topic.id)
      expect(result).toEqual({ topicId: topic.id, messageCount: 3 })

      // In-memory store is cleared
      await expect(service.listMessages(topic.id)).rejects.toThrow(/not found/i)
      await expect(service.deleteTopic(topic.id)).rejects.toThrow(/not found/i)

      // Persistent DB contains the topic with correct activeNodeId
      const [dbTopic] = await realDb!.select().from(topicTable).where(eq(topicTable.id, topic.id)).limit(1)
      expect(dbTopic?.activeNodeId).toBe(m3.id)
      expect(dbTopic?.assistantId).toBe('asst_x')
      expect(dbTopic?.name).toBe('persisted')

      // Messages form a linear chain m1 <- m2 <- m3
      const rows = await realDb!.select().from(messageTable).where(eq(messageTable.topicId, topic.id))
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
      const [dbTopic] = await realDb!.select().from(topicTable).where(eq(topicTable.id, topic.id)).limit(1)
      expect(dbTopic?.activeNodeId).toBeNull()
    })

    it('unknown topicId → notFound', async () => {
      await expect(service.persist('no-such-id')).rejects.toThrow(/not found/i)
    })

    it('rollback: on tx failure, snapshot is restored so user can retry', async () => {
      const topic = await service.createTopic({ name: 'will-fail' })
      const m1 = await service.appendMessage(topic.id, { role: 'user', data: mainText('x') })

      // Break the DB so transaction fails: drop the messages table
      await realDb!.run(sql.raw('DROP TABLE message'))

      await expect(service.persist(topic.id)).rejects.toThrow()

      // Store data is restored — listing still works and shows the message
      const list = await service.listMessages(topic.id)
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe(m1.id)
    })
  })
})
