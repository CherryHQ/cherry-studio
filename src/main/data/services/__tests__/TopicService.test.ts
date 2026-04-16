import { topicTable } from '@data/db/schemas/topic'
import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let realDb: DbType | null = null
let closeClient: (() => void) | undefined

vi.mock('@application', () => ({
  application: {
    get: vi.fn(() => ({
      getDb: vi.fn(() => realDb)
    }))
  }
}))

const { TopicService } = await import('../TopicService')

async function initializeTopicTable(db: DbType) {
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
}

describe('TopicService.list', () => {
  let service: InstanceType<typeof TopicService>

  beforeEach(async () => {
    const client = createClient({ url: 'file::memory:' })
    closeClient = () => client.close()
    realDb = drizzle({ client, casing: 'snake_case' })
    await initializeTopicTable(realDb)
    service = new TopicService()
  })

  afterEach(() => {
    closeClient?.()
    closeClient = undefined
    realDb = null
  })

  it('returns topics for assistant excluding soft-deleted', async () => {
    const assistantId = 'asst-1'
    await realDb!.insert(topicTable).values({
      id: 't1',
      name: 'A',
      assistantId,
      sortOrder: 0,
      isPinned: false,
      pinnedOrder: 0,
      createdAt: 1,
      updatedAt: 100
    })
    await realDb!.insert(topicTable).values({
      id: 't2',
      name: 'B',
      assistantId,
      sortOrder: 1,
      deletedAt: 999,
      isPinned: false,
      pinnedOrder: 0,
      createdAt: 2,
      updatedAt: 200
    })
    await realDb!.insert(topicTable).values({
      id: 't3',
      name: 'Other',
      assistantId: 'asst-2',
      sortOrder: 0,
      isPinned: false,
      pinnedOrder: 0,
      createdAt: 3,
      updatedAt: 300
    })

    const list = await service.list(assistantId)
    expect(list.map((t) => t.id).sort()).toEqual(['t1'])
  })
})
