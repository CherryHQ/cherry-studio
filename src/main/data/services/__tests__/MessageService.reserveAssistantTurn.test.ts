import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import { BlockType, type MessageData } from '@shared/data/types/message'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function mainText(content: string): MessageData {
  return { blocks: [{ type: BlockType.MAIN_TEXT, content, createdAt: 0 }] }
}

// Module-level holder so the DbService override (hoisted-evaluated) sees the
// current test's db without re-mocking per test.
let realDb: DbType | null = null
let closeClient: (() => void) | undefined

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    DbService: { getDb: () => realDb }
  })
})

const { MessageService } = await import('../MessageService')

async function setupDb() {
  const client = createClient({ url: 'file::memory:' })
  closeClient = () => client.close()
  realDb = drizzle({ client, casing: 'snake_case' })
  const db = realDb

  // libsql opens a separate connection for transactions on in-memory DBs,
  // which loses the schema. Run the transaction body inline on the main
  // connection. This means errors thrown mid-callback do NOT roll back —
  // the tests below are validation-failure tests that throw before any
  // INSERT, so this is equivalent in behavior.
  ;(db as unknown as { transaction: unknown }).transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db)

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

  return db
}

describe('MessageService.reserveAssistantTurn', () => {
  let service: InstanceType<typeof MessageService>

  beforeEach(async () => {
    await setupDb()
    service = new MessageService()
  })

  afterEach(() => {
    closeClient?.()
    closeClient = undefined
    realDb = null
  })

  async function seedTopic(id = 'topic-1') {
    await realDb!.insert(topicTable).values({ id })
  }

  describe('fresh single-model turn', () => {
    it('creates user + 1 placeholder and points activeNodeId at the placeholder', async () => {
      await seedTopic()

      const { userMessage, placeholders } = await service.reserveAssistantTurn({
        topicId: 'topic-1',
        userMessage: {
          mode: 'create',
          dto: { role: 'user', parentId: null, data: mainText('hi'), status: 'success' }
        },
        placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending', modelId: 'm-A' }]
      })

      expect(userMessage.parentId).toBeNull()
      expect(userMessage.role).toBe('user')
      expect(placeholders).toHaveLength(1)
      expect(placeholders[0].parentId).toBe(userMessage.id)
      expect(placeholders[0].siblingsGroupId).toBe(0)

      const [topic] = await realDb!.select().from(topicTable).where(eq(topicTable.id, 'topic-1'))
      expect(topic.activeNodeId).toBe(placeholders[0].id)
    })
  })

  describe('fresh multi-model turn', () => {
    it('creates user + N placeholders sharing siblingsGroupId, activeNodeId = last placeholder', async () => {
      await seedTopic()

      const { userMessage, placeholders } = await service.reserveAssistantTurn({
        topicId: 'topic-1',
        userMessage: {
          mode: 'create',
          dto: { role: 'user', parentId: null, data: mainText('hi'), status: 'success' }
        },
        siblingsGroupId: 42,
        placeholders: [
          { role: 'assistant', data: mainText(''), status: 'pending', modelId: 'm-A' },
          { role: 'assistant', data: mainText(''), status: 'pending', modelId: 'm-B' },
          { role: 'assistant', data: mainText(''), status: 'pending', modelId: 'm-C' }
        ]
      })

      expect(placeholders).toHaveLength(3)
      for (const p of placeholders) {
        expect(p.parentId).toBe(userMessage.id)
        expect(p.siblingsGroupId).toBe(42)
      }

      const [topic] = await realDb!.select().from(topicTable).where(eq(topicTable.id, 'topic-1'))
      expect(topic.activeNodeId).toBe(placeholders.at(-1)!.id)
    })
  })

  describe('regenerate — inherit existing group', () => {
    it('adds a new placeholder under existing user message, sharing the inherited group', async () => {
      await seedTopic()
      await realDb!.insert(messageTable).values([
        {
          id: 'u1',
          topicId: 'topic-1',
          parentId: null,
          role: 'user',
          data: mainText('q'),
          status: 'success',
          siblingsGroupId: 0
        },
        {
          id: 'a1',
          topicId: 'topic-1',
          parentId: 'u1',
          role: 'assistant',
          data: mainText('v1'),
          status: 'success',
          siblingsGroupId: 7,
          modelId: 'm-A'
        }
      ])

      const { userMessage, placeholders } = await service.reserveAssistantTurn({
        topicId: 'topic-1',
        userMessage: { mode: 'existing', id: 'u1' },
        siblingsGroupId: 7,
        placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending', modelId: 'm-A' }]
      })

      expect(userMessage.id).toBe('u1')
      expect(placeholders[0].siblingsGroupId).toBe(7)

      const [a1Row] = await realDb!.select().from(messageTable).where(eq(messageTable.id, 'a1'))
      expect(a1Row.siblingsGroupId).toBe(7)
    })
  })

  describe('regenerate — allocate new group and backfill groupId=0 children', () => {
    it('backfills existing sibling with groupId=0 and inserts placeholder with the new group', async () => {
      await seedTopic()
      await realDb!.insert(messageTable).values([
        {
          id: 'u1',
          topicId: 'topic-1',
          parentId: null,
          role: 'user',
          data: mainText('q'),
          status: 'success',
          siblingsGroupId: 0
        },
        {
          id: 'a-old',
          topicId: 'topic-1',
          parentId: 'u1',
          role: 'assistant',
          data: mainText('old'),
          status: 'success',
          siblingsGroupId: 0,
          modelId: 'm-A'
        }
      ])

      const { placeholders } = await service.reserveAssistantTurn({
        topicId: 'topic-1',
        userMessage: { mode: 'existing', id: 'u1' },
        siblingsGroupId: 1234,
        placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending', modelId: 'm-A' }]
      })

      expect(placeholders[0].siblingsGroupId).toBe(1234)

      const [oldRow] = await realDb!.select().from(messageTable).where(eq(messageTable.id, 'a-old'))
      expect(oldRow.siblingsGroupId).toBe(1234)
    })

    it('leaves siblings in other groups alone (only backfills groupId=0)', async () => {
      await seedTopic()
      await realDb!.insert(messageTable).values([
        {
          id: 'u1',
          topicId: 'topic-1',
          parentId: null,
          role: 'user',
          data: mainText('q'),
          status: 'success',
          siblingsGroupId: 0
        },
        {
          id: 'a-other',
          topicId: 'topic-1',
          parentId: 'u1',
          role: 'assistant',
          data: mainText('x'),
          status: 'success',
          siblingsGroupId: 99,
          modelId: 'm-A'
        }
      ])

      await service.reserveAssistantTurn({
        topicId: 'topic-1',
        userMessage: { mode: 'existing', id: 'u1' },
        siblingsGroupId: 1234,
        placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending', modelId: 'm-A' }]
      })

      const [otherRow] = await realDb!.select().from(messageTable).where(eq(messageTable.id, 'a-other'))
      expect(otherRow.siblingsGroupId).toBe(99)
    })
  })

  describe('input validation', () => {
    it('throws when user message id does not exist (existing mode)', async () => {
      await seedTopic()

      await expect(
        service.reserveAssistantTurn({
          topicId: 'topic-1',
          userMessage: { mode: 'existing', id: 'does-not-exist' },
          placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending', modelId: 'm-A' }]
        })
      ).rejects.toThrow()

      const allRows = await realDb!.select().from(messageTable)
      expect(allRows).toHaveLength(0)
    })

    it('throws when parent does not belong to the same topic', async () => {
      await realDb!.insert(topicTable).values([{ id: 'topic-1' }, { id: 'topic-2' }])
      await realDb!.insert(messageTable).values({
        id: 'u-in-t2',
        topicId: 'topic-2',
        parentId: null,
        role: 'user',
        data: mainText('other'),
        status: 'success',
        siblingsGroupId: 0
      })

      await expect(
        service.reserveAssistantTurn({
          topicId: 'topic-1',
          userMessage: {
            mode: 'create',
            dto: { role: 'user', parentId: 'u-in-t2', data: mainText('hi'), status: 'success' }
          },
          placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending', modelId: 'm-A' }]
        })
      ).rejects.toThrow()

      const t1Rows = await realDb!.select().from(messageTable).where(eq(messageTable.topicId, 'topic-1'))
      expect(t1Rows).toHaveLength(0)
    })
  })
})
