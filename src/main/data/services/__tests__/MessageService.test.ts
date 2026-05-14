import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { messageService } from '@data/services/MessageService'
import { DataApiError } from '@shared/data/api'
import { BlockType, type MessageData } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

function mainText(content: string): MessageData {
  return { blocks: [{ type: BlockType.MAIN_TEXT, content, createdAt: 0 }] }
}

describe('MessageService', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'provider-a', name: 'Provider A' },
      { providerId: 'provider-b', name: 'Provider B' }
    ])

    await dbh.db.insert(userModelTable).values([
      {
        id: createUniqueModelId('provider-a', 'model-A'),
        providerId: 'provider-a',
        modelId: 'model-A',
        presetModelId: 'model-A',
        name: 'model-A',
        isEnabled: true,
        isHidden: false,
        sortOrder: 0
      },
      {
        id: createUniqueModelId('provider-b', 'model-B'),
        providerId: 'provider-b',
        modelId: 'model-B',
        presetModelId: 'model-B',
        name: 'model-B',
        isEnabled: true,
        isHidden: false,
        sortOrder: 0
      }
    ])
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
    await dbh.db.insert(topicTable).values({ id: 'topic-1', activeNodeId: 'm-follow', orderKey: 'a0' })

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
        modelId: createUniqueModelId('provider-a', 'model-A'),
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
        modelId: createUniqueModelId('provider-b', 'model-B'),
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
    await dbh.db.insert(messageTable).values(messages)
  }

  describe('getBranchMessages — regression for raw SQL casing bug', () => {
    it('returns camelCase fields (parentId, siblingsGroupId) for path messages', async () => {
      await seedMultiModelTree()

      const result = await messageService.getBranchMessages('topic-1', { includeSiblings: true })

      expect(result.activeNodeId).toBe('m-follow')
      expect(result.items.map((i) => i.message.id)).toEqual(['m-root', 'm-a2', 'm-follow'])

      const a2Item = result.items.find((i) => i.message.id === 'm-a2')!
      expect(a2Item.message.parentId).toBe('m-root')
      expect(a2Item.message.siblingsGroupId).toBe(1)
      expect(a2Item.message.modelId).toBe(createUniqueModelId('provider-b', 'model-B'))

      // Sibling (a1) should be surfaced via the siblings batch query
      expect(a2Item.siblingsGroup).toBeDefined()
      expect(a2Item.siblingsGroup!.map((s) => s.id)).toEqual(['m-a1'])
      expect(a2Item.siblingsGroup![0].siblingsGroupId).toBe(1)
      expect(a2Item.siblingsGroup![0].parentId).toBe('m-root')
    })

    it('returns rooted path with non-undefined parentId for every item', async () => {
      await seedMultiModelTree()

      const result = await messageService.getBranchMessages('topic-1', { includeSiblings: false })

      for (const item of result.items) {
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

      const result = await messageService.getTree('topic-1', { depth: -1 })

      expect(result.activeNodeId).toBe('m-follow')

      expect(result.siblingsGroups).toHaveLength(1)
      const group = result.siblingsGroups[0]
      expect(group.parentId).toBe('m-root')
      expect(group.siblingsGroupId).toBe(1)
      expect(group.nodes.map((n) => n.id).sort()).toEqual(['m-a1', 'm-a2'])

      const rootNode = result.nodes.find((n) => n.id === 'm-root')
      const followNode = result.nodes.find((n) => n.id === 'm-follow')
      expect(rootNode?.parentId).toBeNull()
      expect(followNode?.parentId).toBe('m-a2')
    })
  })

  describe('getPathToNode — regression for raw SQL casing bug', () => {
    it('returns ancestors root-to-node with non-undefined parentId chain', async () => {
      await seedMultiModelTree()

      const path = await messageService.getPathToNode('m-follow')

      expect(path.map((m) => m.id)).toEqual(['m-root', 'm-a2', 'm-follow'])
      expect(path[0].parentId).toBeNull()
      expect(path[1].parentId).toBe('m-root')
      expect(path[1].siblingsGroupId).toBe(1)
      expect(path[1].modelId).toBe(createUniqueModelId('provider-b', 'model-B'))
      expect(path[2].parentId).toBe('m-a2')
    })
  })

  describe('getPathThrough', () => {
    /**
     * Tree shared by these tests:
     *
     *   m-root (t=100)
     *   ├── m-a1 (t=200)
     *   │     └── m-q1 (t=300)
     *   │           ├── m-b1 (t=400)               ← leaf, older
     *   │           └── m-b2 (t=500)
     *   │                 └── m-deep (t=600)        ← leaf, newest in tree
     *   └── m-a2 (t=210)
     *         ├── m-q2 (t=310)                      ← live leaf
     *         └── m-del (t=350, deletedAt set)      ← skipped
     */
    async function seedPathTree() {
      await dbh.db.insert(topicTable).values({ id: 'topic-1', activeNodeId: 'm-deep' })
      await dbh.db.insert(topicTable).values({ id: 'topic-2', activeNodeId: null })

      const rows: (typeof messageTable.$inferInsert)[] = [
        {
          id: 'm-root',
          parentId: null,
          topicId: 'topic-1',
          role: 'user',
          data: mainText('root'),
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
          data: mainText('a1'),
          status: 'success',
          siblingsGroupId: 1,
          createdAt: 200,
          updatedAt: 200
        },
        {
          id: 'm-a2',
          parentId: 'm-root',
          topicId: 'topic-1',
          role: 'assistant',
          data: mainText('a2'),
          status: 'success',
          siblingsGroupId: 1,
          createdAt: 210,
          updatedAt: 210
        },
        {
          id: 'm-q1',
          parentId: 'm-a1',
          topicId: 'topic-1',
          role: 'user',
          data: mainText('q1'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 300,
          updatedAt: 300
        },
        {
          id: 'm-b1',
          parentId: 'm-q1',
          topicId: 'topic-1',
          role: 'assistant',
          data: mainText('b1'),
          status: 'success',
          siblingsGroupId: 2,
          createdAt: 400,
          updatedAt: 400
        },
        {
          id: 'm-b2',
          parentId: 'm-q1',
          topicId: 'topic-1',
          role: 'assistant',
          data: mainText('b2'),
          status: 'success',
          siblingsGroupId: 2,
          createdAt: 500,
          updatedAt: 500
        },
        {
          id: 'm-deep',
          parentId: 'm-b2',
          topicId: 'topic-1',
          role: 'user',
          data: mainText('deep'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 600,
          updatedAt: 600
        },
        {
          id: 'm-q2',
          parentId: 'm-a2',
          topicId: 'topic-1',
          role: 'user',
          data: mainText('q2'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 310,
          updatedAt: 310
        },
        {
          id: 'm-del',
          parentId: 'm-a2',
          topicId: 'topic-1',
          role: 'user',
          data: mainText('deleted'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 350,
          updatedAt: 350,
          deletedAt: 360
        }
      ]
      await dbh.db.insert(messageTable).values(rows)
    }

    it('descends to the most recent leaf in the subtree', async () => {
      await seedPathTree()
      // a1's subtree leaves: m-b1 (t=400), m-deep (t=600). Should pick m-deep.
      const path = await messageService.getPathThrough('topic-1', 'm-a1')
      expect(path.map((m) => m.id)).toEqual(['m-root', 'm-a1', 'm-q1', 'm-b2', 'm-deep'])
    })

    it('skips deleted children when descending', async () => {
      await seedPathTree()
      // a2's subtree: m-q2 (live, t=310), m-del (deleted). Should land on m-q2.
      const path = await messageService.getPathThrough('topic-1', 'm-a2')
      expect(path.map((m) => m.id)).toEqual(['m-root', 'm-a2', 'm-q2'])
    })

    it('returns root → nodeId when nodeId is itself a leaf', async () => {
      await seedPathTree()
      const path = await messageService.getPathThrough('topic-1', 'm-deep')
      expect(path.map((m) => m.id)).toEqual(['m-root', 'm-a1', 'm-q1', 'm-b2', 'm-deep'])
    })

    it('descends from root to the globally newest leaf', async () => {
      await seedPathTree()
      const path = await messageService.getPathThrough('topic-1', 'm-root')
      expect(path[path.length - 1].id).toBe('m-deep')
    })

    it('throws NOT_FOUND for unknown nodeId', async () => {
      await seedPathTree()
      await expect(messageService.getPathThrough('topic-1', 'm-nope')).rejects.toThrow(DataApiError)
    })

    it('throws NOT_FOUND when nodeId belongs to a different topic', async () => {
      await seedPathTree()
      await expect(messageService.getPathThrough('topic-2', 'm-a1')).rejects.toThrow(DataApiError)
    })
  })
})
