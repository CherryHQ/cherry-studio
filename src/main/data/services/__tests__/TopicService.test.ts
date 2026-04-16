import { messageTable } from '@data/db/schemas/message'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { topicTable } from '@data/db/schemas/topic'
import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let realDb: DbType | null = null
let closeClient: (() => void) | undefined

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    DbService: { getDb: () => realDb }
  })
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('../MessageService', () => ({
  messageService: {
    getById: vi.fn(),
    getPathToNode: vi.fn()
  }
}))

const { topicService } = await import('../TopicService')

async function setupDb() {
  const client = createClient({ url: 'file::memory:' })
  closeClient = () => client.close()
  realDb = drizzle({ client, casing: 'snake_case' })
  const db = realDb

  await db.run(sql`PRAGMA foreign_keys = ON`)
  ;(db as any).transaction = async (fn: (tx: any) => Promise<any>) => fn(db)

  await db.run(
    sql.raw(`
      CREATE TABLE topic (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        is_name_manually_edited INTEGER,
        assistant_id TEXT,
        active_node_id TEXT,
        group_id TEXT,
        sort_order INTEGER,
        is_pinned INTEGER,
        pinned_order INTEGER,
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
        topic_id TEXT NOT NULL REFERENCES topic(id) ON DELETE CASCADE,
        parent_id TEXT,
        role TEXT,
        data TEXT,
        searchable_text TEXT,
        status TEXT,
        siblings_group_id INTEGER,
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

  await db.run(
    sql.raw(`
      CREATE TABLE tag (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)
  )

  await db.run(
    sql.raw(`
      CREATE TABLE entity_tag (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        tag_id TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
        created_at INTEGER,
        updated_at INTEGER,
        PRIMARY KEY (entity_type, entity_id, tag_id)
      )
    `)
  )

  return db
}

describe('TopicService', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setupDb()
  })

  afterEach(() => {
    closeClient?.()
    closeClient = undefined
    realDb = null
  })

  describe('delete', () => {
    it('should remove topic messages and entity tags in one delete flow', async () => {
      const db = realDb!
      await db.insert(topicTable).values({ id: 'topic-1', name: 'Topic', createdAt: 1, updatedAt: 1 })
      await db.run(
        sql.raw(
          "INSERT INTO message (id, topic_id, siblings_group_id, created_at, updated_at) VALUES ('msg-1', 'topic-1', 0, 1, 1)"
        )
      )
      await db.insert(tagTable).values({ id: 'tag-1', name: 'work' })
      await db.insert(entityTagTable).values({ entityType: 'topic', entityId: 'topic-1', tagId: 'tag-1' })

      await topicService.delete('topic-1')

      expect(await db.select().from(topicTable)).toHaveLength(0)
      expect(await db.select().from(messageTable)).toHaveLength(0)
      expect(await db.select().from(entityTagTable)).toHaveLength(0)
    })
  })
})
