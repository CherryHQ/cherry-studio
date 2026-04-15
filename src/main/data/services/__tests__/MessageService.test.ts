import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import { BlockType, type MessageData } from '@shared/data/types/message'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const { MessageService } = await import('../MessageService')

/**
 * Create just the topic and message tables we need for these tests.
 * FK enforcement is left off — these tests focus on tree/CTE semantics,
 * not referential integrity. Triggers and FTS5 are also skipped.
 */
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

describe('MessageService', () => {
  let service: InstanceType<typeof MessageService>

  beforeEach(async () => {
    const client = createClient({ url: 'file::memory:' })
    closeClient = () => client.close()
    realDb = drizzle({ client, casing: 'snake_case' })
    await initializeTables(realDb)
    service = new MessageService()
  })

  afterEach(() => {
    closeClient?.()
    closeClient = undefined
    realDb = null
  })

  /**
   * Build a small message tree with a multi-model siblings group.
   *
   *   root (user)
   *     └── a1 (assistant, model-A, siblingsGroupId=1)
   *     └── a2 (assistant, model-B, siblingsGroupId=1)
   *           └── follow (user)
   */
  async function seedMultiModelTree() {
    const db = realDb!
    await db.insert(topicTable).values({ id: 'topic-1', activeNodeId: 'm-follow' })

    const messages: (typeof messageTable.$inferInsert)[] = [
      {
        id: 'm-root',
        parentId: null,
        topicId: 'topic-1',
        role: 'user',
        data: mainText('hi'),
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: 'm-a1',
        parentId: 'm-root',
        topicId: 'topic-1',
        role: 'assistant',
        data: mainText('reply A'),
        status: 'success',
        siblingsGroupId: 1,
        modelId: 'model-A',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: 'm-a2',
        parentId: 'm-root',
        topicId: 'topic-1',
        role: 'assistant',
        data: mainText('reply B'),
        status: 'success',
        siblingsGroupId: 1,
        modelId: 'model-B',
        createdAt: 210,
        updatedAt: 210
      },
      {
        id: 'm-follow',
        parentId: 'm-a2',
        topicId: 'topic-1',
        role: 'user',
        data: mainText('follow up'),
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 300,
        updatedAt: 300
      }
    ]
    await db.insert(messageTable).values(messages)
  }

  describe('getBranchMessages — regression for raw SQL casing bug', () => {
    it('returns camelCase fields (parentId, siblingsGroupId) for path messages', async () => {
      await seedMultiModelTree()

      const result = await service.getBranchMessages('topic-1', { includeSiblings: true })

      expect(result.activeNodeId).toBe('m-follow')
      expect(result.items.map((i) => i.message.id)).toEqual(['m-root', 'm-a2', 'm-follow'])

      const a2Item = result.items.find((i) => i.message.id === 'm-a2')!
      expect(a2Item.message.parentId).toBe('m-root')
      expect(a2Item.message.siblingsGroupId).toBe(1)
      expect(a2Item.message.modelId).toBe('model-B')

      // Sibling (a1) should be surfaced via the siblings batch query
      expect(a2Item.siblingsGroup).toBeDefined()
      expect(a2Item.siblingsGroup!.map((s) => s.id)).toEqual(['m-a1'])
      expect(a2Item.siblingsGroup![0].siblingsGroupId).toBe(1)
      expect(a2Item.siblingsGroup![0].parentId).toBe('m-root')
    })

    it('returns rooted path with non-undefined parentId for every item', async () => {
      await seedMultiModelTree()

      const result = await service.getBranchMessages('topic-1', { includeSiblings: false })

      for (const item of result.items) {
        // Before the fix, parentId would be undefined for non-root items.
        if (item.message.id === 'm-root') {
          expect(item.message.parentId).toBeNull()
        } else {
          expect(item.message.parentId).toEqual(expect.any(String))
        }
      }
    })
  })

  describe('getTree — regression for raw SQL casing bug', () => {
    it('returns tree nodes with correct parentId and groups multi-model siblings', async () => {
      await seedMultiModelTree()

      const result = await service.getTree('topic-1', { depth: -1 })

      expect(result.activeNodeId).toBe('m-follow')

      // a1 + a2 form a siblings group; the API surfaces them via siblingsGroups
      // rather than as flat nodes — verify the group exists and references root.
      expect(result.siblingsGroups).toHaveLength(1)
      const group = result.siblingsGroups[0]
      expect(group.parentId).toBe('m-root')
      expect(group.siblingsGroupId).toBe(1)
      expect(group.nodes.map((n) => n.id).sort()).toEqual(['m-a1', 'm-a2'])

      // Root and follow appear as flat nodes; their parentId must be camelCase.
      const rootNode = result.nodes.find((n) => n.id === 'm-root')
      const followNode = result.nodes.find((n) => n.id === 'm-follow')
      expect(rootNode?.parentId).toBeNull()
      expect(followNode?.parentId).toBe('m-a2')
    })
  })

  describe('getPathToNode — regression for raw SQL casing bug', () => {
    it('returns ancestors root-to-node with non-undefined parentId chain', async () => {
      await seedMultiModelTree()

      const path = await service.getPathToNode('m-follow')

      expect(path.map((m) => m.id)).toEqual(['m-root', 'm-a2', 'm-follow'])
      expect(path[0].parentId).toBeNull()
      expect(path[1].parentId).toBe('m-root')
      expect(path[1].siblingsGroupId).toBe(1)
      expect(path[1].modelId).toBe('model-B')
      expect(path[2].parentId).toBe('m-a2')
    })
  })
})
