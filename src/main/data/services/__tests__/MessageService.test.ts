import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { messageService } from '@data/services/MessageService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { MessageData } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

function mainText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] }
}

function partsText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] as MessageData['parts'] }
}

describe('MessageService', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    const [providerAKey, providerBKey, modelAKey, modelBKey] = generateOrderKeySequence(4)
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'provider-a', name: 'Provider A', orderKey: providerAKey },
      { providerId: 'provider-b', name: 'Provider B', orderKey: providerBKey }
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
        orderKey: modelAKey
      },
      {
        id: createUniqueModelId('provider-b', 'model-B'),
        providerId: 'provider-b',
        modelId: 'model-B',
        presetModelId: 'model-B',
        name: 'model-B',
        isEnabled: true,
        isHidden: false,
        orderKey: modelBKey
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

  describe('findPendingAssistantMessageIds', () => {
    it('returns only non-deleted assistant rows still in pending', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-p', activeNodeId: 'm-pending', orderKey: 'b0' })
      await dbh.db.insert(messageTable).values([
        {
          id: 'm-u',
          parentId: null,
          topicId: 'topic-p',
          role: 'user',
          data: mainText('q'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        },
        {
          id: 'm-pending',
          parentId: 'm-u',
          topicId: 'topic-p',
          role: 'assistant',
          data: mainText(''),
          status: 'pending',
          siblingsGroupId: 1,
          modelId: createUniqueModelId('provider-a', 'model-A'),
          createdAt: 200,
          updatedAt: 200
        },
        {
          id: 'm-done',
          parentId: 'm-u',
          topicId: 'topic-p',
          role: 'assistant',
          data: mainText('done'),
          status: 'success',
          siblingsGroupId: 1,
          modelId: createUniqueModelId('provider-b', 'model-B'),
          createdAt: 210,
          updatedAt: 210
        },
        {
          id: 'm-pending-user',
          parentId: 'm-u',
          topicId: 'topic-p',
          role: 'user',
          data: mainText(''),
          status: 'pending',
          siblingsGroupId: 0,
          createdAt: 220,
          updatedAt: 220
        },
        {
          id: 'm-pending-deleted',
          parentId: 'm-u',
          topicId: 'topic-p',
          role: 'assistant',
          data: mainText(''),
          status: 'pending',
          siblingsGroupId: 2,
          modelId: createUniqueModelId('provider-a', 'model-A'),
          createdAt: 230,
          updatedAt: 230,
          deletedAt: 999
        }
      ])

      const pendingIds = await messageService.findPendingAssistantMessageIds()
      expect(pendingIds).toEqual(['m-pending'])
    })
  })

  describe('markMessagesError', () => {
    async function seedStatuses() {
      await dbh.db.insert(topicTable).values({ id: 'topic-e', activeNodeId: 'm-a', orderKey: 'c0' })
      await dbh.db.insert(messageTable).values([
        {
          id: 'm-a',
          parentId: null,
          topicId: 'topic-e',
          role: 'assistant',
          data: mainText(''),
          status: 'pending',
          siblingsGroupId: 1,
          createdAt: 100,
          updatedAt: 100
        },
        {
          id: 'm-b',
          parentId: null,
          topicId: 'topic-e',
          role: 'assistant',
          data: mainText(''),
          status: 'pending',
          siblingsGroupId: 2,
          createdAt: 110,
          updatedAt: 110
        },
        {
          id: 'm-keep',
          parentId: null,
          topicId: 'topic-e',
          role: 'assistant',
          data: mainText('done'),
          status: 'success',
          siblingsGroupId: 3,
          createdAt: 120,
          updatedAt: 120
        }
      ])
    }

    const statusOf = async (id: string) => {
      const [row] = await dbh.db.select().from(messageTable).where(eq(messageTable.id, id))
      return row?.status
    }

    it('flips only the listed rows to error and leaves others untouched', async () => {
      await seedStatuses()

      await messageService.markMessagesError(['m-a', 'm-b'])

      expect(await statusOf('m-a')).toBe('error')
      expect(await statusOf('m-b')).toBe('error')
      expect(await statusOf('m-keep')).toBe('success')
    })

    it('is a no-op for an empty id list', async () => {
      await seedStatuses()

      await messageService.markMessagesError([])

      expect(await statusOf('m-a')).toBe('pending')
    })
  })

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

    it('rejects an explicit node outside the requested topic', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'topic-1', activeNodeId: null, orderKey: 'a0' },
        { id: 'topic-2', activeNodeId: 'other-node', orderKey: 'a1' }
      ])
      await dbh.db.insert(messageTable).values({
        id: 'other-node',
        parentId: null,
        topicId: 'topic-2',
        role: 'user',
        data: mainText('other'),
        status: 'success',
        siblingsGroupId: 0
      })

      await expect(messageService.getBranchMessages('topic-1', { nodeId: 'other-node' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('search', () => {
    it('searches v2 parts text and returns message snippets', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-search', activeNodeId: 'm-search-1', orderKey: 's0' })
      await dbh.db.insert(messageTable).values([
        {
          id: 'm-search-1',
          parentId: null,
          topicId: 'topic-search',
          role: 'assistant',
          data: partsText('The v2 parts payload contains a unique needle.'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        },
        {
          id: 'm-search-2',
          parentId: 'm-search-1',
          topicId: 'topic-search',
          role: 'assistant',
          data: partsText('No matching term here.'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 200,
          updatedAt: 200
        }
      ])

      const result = await messageService.search({ q: 'needle' })

      expect(result.items).toHaveLength(1)
      expect(result.nextCursor).toBeUndefined()
      expect(result.items[0]).toMatchObject({
        messageId: 'm-search-1',
        topicId: 'topic-search',
        topicName: '',
        topicAssistantId: undefined,
        role: 'assistant',
        topicCreatedAt: expect.any(String),
        topicUpdatedAt: expect.any(String)
      })
      expect(result.items[0].snippet).toContain('unique needle')
      expect(result.items[0].createdAt).toBe('1970-01-01T00:00:00.100Z')

      const stored = await dbh.db
        .select({ searchableText: messageTable.searchableText })
        .from(messageTable)
        .where(eq(messageTable.id, 'm-search-1'))
      expect(stored[0].searchableText).toContain('unique needle')
    })

    it('uses substring matching for terms that FTS would treat as whole tokens', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-substring', activeNodeId: 'm-substring-2', orderKey: 's5' })
      await dbh.db.insert(messageTable).values([
        {
          id: 'm-substring-1',
          parentId: null,
          topicId: 'topic-substring',
          role: 'assistant',
          data: partsText('abcneedledef is embedded in a larger token.'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        },
        {
          id: 'm-substring-2',
          parentId: 'm-substring-1',
          topicId: 'topic-substring',
          role: 'assistant',
          data: partsText('needle appears as a separate token too.'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 200,
          updatedAt: 200
        }
      ])

      const result = await messageService.search({ q: 'needle' })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-substring-2', 'm-substring-1'])
    })

    it('requires all search terms to match a message', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-search-and', activeNodeId: 'm-search-and-2', orderKey: 'sa0' })
      await dbh.db.insert(messageTable).values([
        {
          id: 'm-search-and-1',
          parentId: null,
          topicId: 'topic-search-and',
          role: 'assistant',
          data: partsText('alpha needle appear together.'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        },
        {
          id: 'm-search-and-2',
          parentId: 'm-search-and-1',
          topicId: 'topic-search-and',
          role: 'assistant',
          data: partsText('needle appears without the other term.'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 200,
          updatedAt: 200
        }
      ])

      const result = await messageService.search({ q: 'alpha needle' })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-search-and-1'])
    })

    it('treats LIKE wildcards as literal search text after FTS prefiltering', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-search-literal', activeNodeId: 'm-search-literal-2', orderKey: 'sl0' })
      await dbh.db.insert(messageTable).values([
        {
          id: 'm-search-literal-1',
          parentId: null,
          topicId: 'topic-search-literal',
          role: 'assistant',
          data: partsText('Save 50% off today.'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        },
        {
          id: 'm-search-literal-2',
          parentId: 'm-search-literal-1',
          topicId: 'topic-search-literal',
          role: 'assistant',
          data: partsText('Save 50X off today.'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 200,
          updatedAt: 200
        },
        {
          id: 'm-search-literal-3',
          parentId: 'm-search-literal-2',
          topicId: 'topic-search-literal',
          role: 'assistant',
          data: partsText('Save 50_ off today.'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 300,
          updatedAt: 300
        }
      ])

      const percentResult = await messageService.search({ q: '50%' })
      const underscoreResult = await messageService.search({ q: '50_' })

      expect(percentResult.items.map((item) => item.messageId)).toEqual(['m-search-literal-1'])
      expect(underscoreResult.items.map((item) => item.messageId)).toEqual(['m-search-literal-3'])
    })

    it('uses the message FTS index as the search candidate source', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-fts-candidate', activeNodeId: 'm-fts-candidate', orderKey: 'sf0' })
      await dbh.db.insert(messageTable).values({
        id: 'm-fts-candidate',
        parentId: null,
        topicId: 'topic-fts-candidate',
        role: 'assistant',
        data: partsText('needle exists in the base message text.'),
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 100,
        updatedAt: 100
      })

      const ftsRow = await dbh.client.execute({
        sql: 'SELECT rowid, searchable_text FROM message WHERE id = ?',
        args: ['m-fts-candidate']
      })
      await dbh.client.execute({
        sql: `INSERT INTO message_fts(message_fts, rowid, searchable_text)
              VALUES ('delete', ?, ?)`,
        args: [ftsRow.rows[0][0], ftsRow.rows[0][1]]
      })

      let result: Awaited<ReturnType<typeof messageService.search>>
      try {
        result = await messageService.search({ q: 'needle' })
      } finally {
        await dbh.client.execute(`INSERT INTO message_fts(message_fts) VALUES ('rebuild')`)
      }

      expect(result.items).toEqual([])
    })

    it('defaults message search to substring matching', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-substring-default', activeNodeId: 'm-substring-default', orderKey: 'sd0' })
      await dbh.db.insert(messageTable).values({
        id: 'm-substring-default',
        parentId: null,
        topicId: 'topic-substring-default',
        role: 'assistant',
        data: partsText('abcneedledef is embedded in a larger token.'),
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 100,
        updatedAt: 100
      })

      const result = await messageService.search({ q: 'needle' })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-substring-default'])
    })

    it('filters substring search by topic id', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'topic-substring-filter', activeNodeId: 'm-substring-filter-target', orderKey: 'sf0' },
        { id: 'topic-substring-other', activeNodeId: 'm-substring-filter-other', orderKey: 'sf1' }
      ])
      await dbh.db.insert(messageTable).values([
        {
          id: 'm-substring-filter-target',
          parentId: null,
          topicId: 'topic-substring-filter',
          role: 'assistant',
          data: partsText('needle appears in the target topic.'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 200,
          updatedAt: 200
        },
        {
          id: 'm-substring-filter-other',
          parentId: null,
          topicId: 'topic-substring-other',
          role: 'assistant',
          data: partsText('needle appears in another topic too.'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 300,
          updatedAt: 300
        }
      ])

      const result = await messageService.search({
        q: 'needle',
        topicId: 'topic-substring-filter'
      })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-substring-filter-target'])
    })

    it('filters substring search by createdAtFrom', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-created-substring', activeNodeId: 'm-created-new', orderKey: 'cf0' })
      await dbh.db.insert(messageTable).values([
        {
          id: 'm-created-old',
          parentId: null,
          topicId: 'topic-created-substring',
          role: 'assistant',
          data: partsText('needle in an older answer'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 500
        },
        {
          id: 'm-created-new',
          parentId: null,
          topicId: 'topic-created-substring',
          role: 'assistant',
          data: partsText('needle in a newer answer'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 300,
          updatedAt: 300
        }
      ])

      const result = await messageService.search({
        q: 'needle',
        createdAtFrom: '1970-01-01T00:00:00.250Z'
      })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-created-new'])
    })

    it('orders matches by newest message before applying limit', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-order', activeNodeId: 'm-order-new', orderKey: 's2' })
      await dbh.db.insert(messageTable).values([
        {
          id: 'm-order-old',
          parentId: null,
          topicId: 'topic-order',
          role: 'assistant',
          data: partsText('needle in an older answer'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        },
        {
          id: 'm-order-new',
          parentId: null,
          topicId: 'topic-order',
          role: 'assistant',
          data: partsText('needle in a newer answer'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 300,
          updatedAt: 300
        }
      ])

      const result = await messageService.search({ q: 'needle', limit: 1 })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-order-new'])
    })

    it('uses message id as the cursor tiebreaker when createdAt values match', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-page-tie', activeNodeId: 'm-page-tie-3', orderKey: 'st0' })
      await dbh.db.insert(messageTable).values([
        {
          id: 'm-page-tie-1',
          parentId: null,
          topicId: 'topic-page-tie',
          role: 'assistant',
          data: partsText('needle tie one'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        },
        {
          id: 'm-page-tie-2',
          parentId: 'm-page-tie-1',
          topicId: 'topic-page-tie',
          role: 'assistant',
          data: partsText('needle tie two'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        },
        {
          id: 'm-page-tie-3',
          parentId: 'm-page-tie-2',
          topicId: 'topic-page-tie',
          role: 'assistant',
          data: partsText('needle tie three'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        }
      ])

      const firstPage = await messageService.search({ q: 'needle', limit: 2 })
      const secondPage = await messageService.search({
        q: 'needle',
        limit: 2,
        cursor: firstPage.nextCursor
      })

      expect(firstPage.items.map((item) => item.messageId)).toEqual(['m-page-tie-3', 'm-page-tie-2'])
      expect(firstPage.nextCursor).toBe('100:m-page-tie-2')
      expect(secondPage.items.map((item) => item.messageId)).toEqual(['m-page-tie-1'])
      expect(secondPage.nextCursor).toBeUndefined()
    })

    it('returns a cursor for the next search result page', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-page', activeNodeId: 'm-page-3', orderKey: 's6' })
      await dbh.db.insert(messageTable).values([
        {
          id: 'm-page-1',
          parentId: null,
          topicId: 'topic-page',
          role: 'assistant',
          data: partsText('needle page one'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        },
        {
          id: 'm-page-2',
          parentId: 'm-page-1',
          topicId: 'topic-page',
          role: 'assistant',
          data: partsText('needle page two'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 200,
          updatedAt: 200
        },
        {
          id: 'm-page-3',
          parentId: 'm-page-2',
          topicId: 'topic-page',
          role: 'assistant',
          data: partsText('needle page three'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 300,
          updatedAt: 300
        }
      ])

      const firstPage = await messageService.search({ q: 'needle', limit: 2 })
      await dbh.db.update(messageTable).set({ deletedAt: 400 }).where(eq(messageTable.id, 'm-page-2'))
      const secondPage = await messageService.search({
        q: 'needle',
        limit: 2,
        cursor: firstPage.nextCursor
      })

      expect(firstPage.items.map((item) => item.messageId)).toEqual(['m-page-3', 'm-page-2'])
      expect(firstPage.nextCursor).toBeDefined()
      expect(secondPage.items.map((item) => item.messageId)).toEqual(['m-page-1'])
      expect(secondPage.nextCursor).toBeUndefined()
    })

    it('rejects malformed search cursors', async () => {
      await expect(messageService.search({ q: 'needle', cursor: 'not-a-cursor' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      })
      await expect(messageService.search({ q: 'needle', cursor: 'abc:m-search-1' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      })
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

      // Regression: preview is derived from data.parts text (was always '' when it read data.blocks).
      expect(rootNode?.preview).toBe('hi')
      expect(followNode?.preview).toBe('follow up')
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

  describe('copyPathRowsTx', () => {
    it('rejects rows whose parent has not been copied', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'source-topic', orderKey: 'a0' },
        { id: 'target-topic', orderKey: 'a1' }
      ])
      await dbh.db.insert(messageTable).values([
        {
          id: 'source-root',
          parentId: null,
          topicId: 'source-topic',
          role: 'user',
          data: mainText('root'),
          status: 'success',
          siblingsGroupId: 0
        },
        {
          id: 'source-child',
          parentId: 'source-root',
          topicId: 'source-topic',
          role: 'assistant',
          data: mainText('child'),
          status: 'success',
          siblingsGroupId: 0
        }
      ])
      const childRows = await dbh.db.select().from(messageTable).where(eq(messageTable.id, 'source-child'))
      expect(childRows).toHaveLength(1)

      await expect(
        dbh.db.transaction((tx) => messageService.copyPathRowsTx(tx, childRows, { topicId: 'target-topic' }))
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })

      const targetRows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 'target-topic'))
      expect(targetRows).toHaveLength(0)
    })
  })

  describe('createUserMessageWithPlaceholders — placeholder id override', () => {
    it('uses the caller-supplied id when provided, generates otherwise', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-res', activeNodeId: null, orderKey: 'a0' })

      const suppliedId = '11111111-1111-4111-8111-111111111111'
      const { userMessage, placeholders } = await messageService.createUserMessageWithPlaceholders({
        topicId: 'topic-res',
        userMessage: {
          mode: 'create',
          dto: { role: 'user', parentId: null, data: mainText('hi'), status: 'success' }
        },
        placeholders: [
          { id: suppliedId, role: 'assistant', data: { parts: [] }, status: 'pending' },
          { role: 'assistant', data: { parts: [] }, status: 'pending' }
        ]
      })

      expect(userMessage.role).toBe('user')
      expect(placeholders[0].id).toBe(suppliedId)
      // Second placeholder falls back to the uuidv7 default — format check only.
      expect(placeholders[1].id).not.toBe(suppliedId)
      expect(placeholders[1].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

      // activeNodeId points at the last placeholder regardless of id source.
      const [topic] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 'topic-res')).limit(1)
      expect(topic.activeNodeId).toBe(placeholders[1].id)
    })
  })

  describe('createUserMessageWithPlaceholders', () => {
    async function seedTopic(id = 'topic-1') {
      await dbh.db.insert(topicTable).values({ id, orderKey: 'a0' })
    }

    describe('fresh single-model turn', () => {
      it('creates user + 1 placeholder and points activeNodeId at the placeholder', async () => {
        await seedTopic()

        const { userMessage, placeholders } = await messageService.createUserMessageWithPlaceholders({
          topicId: 'topic-1',
          userMessage: {
            mode: 'create',
            dto: { role: 'user', parentId: null, data: mainText('hi'), status: 'success' }
          },
          placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending' }]
        })

        expect(userMessage.parentId).toBeNull()
        expect(userMessage.role).toBe('user')
        expect(placeholders).toHaveLength(1)
        expect(placeholders[0].parentId).toBe(userMessage.id)
        expect(placeholders[0].siblingsGroupId).toBe(0)

        const [topic] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 'topic-1'))
        expect(topic.activeNodeId).toBe(placeholders[0].id)
      })
    })

    describe('fresh multi-model turn', () => {
      it('creates user + N placeholders sharing siblingsGroupId, activeNodeId = last placeholder', async () => {
        await seedTopic()

        const { userMessage, placeholders } = await messageService.createUserMessageWithPlaceholders({
          topicId: 'topic-1',
          userMessage: {
            mode: 'create',
            dto: { role: 'user', parentId: null, data: mainText('hi'), status: 'success' }
          },
          siblingsGroupId: 42,
          placeholders: [
            { role: 'assistant', data: mainText(''), status: 'pending' },
            { role: 'assistant', data: mainText(''), status: 'pending' },
            { role: 'assistant', data: mainText(''), status: 'pending' }
          ]
        })

        expect(placeholders).toHaveLength(3)
        for (const p of placeholders) {
          expect(p.parentId).toBe(userMessage.id)
          expect(p.siblingsGroupId).toBe(42)
        }

        const [topic] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 'topic-1'))
        expect(topic.activeNodeId).toBe(placeholders.at(-1)!.id)
      })
    })

    describe('regenerate — inherit existing group', () => {
      it('adds a new placeholder under existing user message, sharing the inherited group', async () => {
        await seedTopic()
        await dbh.db.insert(messageTable).values([
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
            siblingsGroupId: 7
          }
        ])

        const { userMessage, placeholders } = await messageService.createUserMessageWithPlaceholders({
          topicId: 'topic-1',
          userMessage: { mode: 'existing', id: 'u1' },
          siblingsGroupId: 7,
          placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending' }]
        })

        expect(userMessage.id).toBe('u1')
        expect(placeholders[0].siblingsGroupId).toBe(7)

        const [a1Row] = await dbh.db.select().from(messageTable).where(eq(messageTable.id, 'a1'))
        expect(a1Row.siblingsGroupId).toBe(7)
      })
    })

    describe('regenerate — allocate new group and backfill groupId=0 children', () => {
      it('backfills existing sibling with groupId=0 and inserts placeholder with the new group', async () => {
        await seedTopic()
        await dbh.db.insert(messageTable).values([
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
            siblingsGroupId: 0
          }
        ])

        const { placeholders } = await messageService.createUserMessageWithPlaceholders({
          topicId: 'topic-1',
          userMessage: { mode: 'existing', id: 'u1' },
          siblingsGroupId: 1234,
          placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending' }]
        })

        expect(placeholders[0].siblingsGroupId).toBe(1234)

        const [oldRow] = await dbh.db.select().from(messageTable).where(eq(messageTable.id, 'a-old'))
        expect(oldRow.siblingsGroupId).toBe(1234)
      })

      it('leaves siblings in other groups alone (only backfills groupId=0)', async () => {
        await seedTopic()
        await dbh.db.insert(messageTable).values([
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
            siblingsGroupId: 99
          }
        ])

        await messageService.createUserMessageWithPlaceholders({
          topicId: 'topic-1',
          userMessage: { mode: 'existing', id: 'u1' },
          siblingsGroupId: 1234,
          placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending' }]
        })

        const [otherRow] = await dbh.db.select().from(messageTable).where(eq(messageTable.id, 'a-other'))
        expect(otherRow.siblingsGroupId).toBe(99)
      })
    })

    describe('input validation', () => {
      it('throws when user message id does not exist (existing mode)', async () => {
        await seedTopic()

        await expect(
          messageService.createUserMessageWithPlaceholders({
            topicId: 'topic-1',
            userMessage: { mode: 'existing', id: 'does-not-exist' },
            placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending' }]
          })
        ).rejects.toThrow()

        const allRows = await dbh.db.select().from(messageTable)
        expect(allRows).toHaveLength(0)
      })

      it('throws when parent does not belong to the same topic', async () => {
        await dbh.db.insert(topicTable).values([
          { id: 'topic-1', orderKey: 'a0' },
          { id: 'topic-2', orderKey: 'a1' }
        ])
        await dbh.db.insert(messageTable).values({
          id: 'u-in-t2',
          topicId: 'topic-2',
          parentId: null,
          role: 'user',
          data: mainText('other'),
          status: 'success',
          siblingsGroupId: 0
        })

        await expect(
          messageService.createUserMessageWithPlaceholders({
            topicId: 'topic-1',
            userMessage: {
              mode: 'create',
              dto: { role: 'user', parentId: 'u-in-t2', data: mainText('hi'), status: 'success' }
            },
            placeholders: [{ role: 'assistant', data: mainText(''), status: 'pending' }]
          })
        ).rejects.toThrow()

        const t1Rows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 'topic-1'))
        expect(t1Rows).toHaveLength(0)
      })
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
      await dbh.db.insert(topicTable).values({ id: 'topic-1', activeNodeId: 'm-deep', orderKey: 'a0' })
      await dbh.db.insert(topicTable).values({ id: 'topic-2', activeNodeId: null, orderKey: 'a1' })

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

  describe('applyToolApprovalDecisions', () => {
    const toolPart = (callId: string, approvalId: string) =>
      ({
        type: 'tool-fetch_url',
        toolCallId: callId,
        state: 'approval-requested',
        input: {},
        approval: { id: approvalId }
      }) as unknown

    const stateOf = (parts: MessageData['parts'] | undefined, approvalId: string): string | undefined => {
      const p = (parts ?? []).find((x) => (x as { approval?: { id: string } }).approval?.id === approvalId)
      return (p as { state?: string } | undefined)?.state
    }

    async function seedAnchorWithTwoApprovals() {
      await dbh.db.insert(topicTable).values({ id: 'topic-ap', activeNodeId: 'anchor', orderKey: 'a0' })
      await dbh.db.insert(messageTable).values({
        id: 'anchor',
        parentId: null,
        topicId: 'topic-ap',
        role: 'assistant',
        data: { parts: [toolPart('c-a', 'ap-a'), toolPart('c-b', 'ap-b')] as MessageData['parts'] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 100,
        updatedAt: 100
      })
    }

    // The fix's core property: each call re-reads the anchor's CURRENT parts inside the transaction
    // and merges its decision, so a second decision sees the first's committed write (rather than a
    // stale snapshot taken before it). That re-read is exactly what makes the real `withWriteTx`
    // mutex safe under concurrency — the production mutex serializes whole calls; here we assert the
    // per-call read-modify-write picks up committed state. (The test DbService mock's `withWriteTx`
    // is a non-serializing passthrough, so true concurrency is the mutex's job, asserted at that level.)
    it('re-reads committed state per call so a later decision preserves the earlier one', async () => {
      await seedAnchorWithTwoApprovals()

      const r1 = await messageService.applyToolApprovalDecisions('anchor', [{ approvalId: 'ap-a', approved: true }])
      expect(r1?.appliedApprovalIds).toEqual(['ap-a'])
      expect(r1?.alreadySettledApprovalIds).toEqual([])
      expect(stateOf(r1?.parts, 'ap-a')).toBe('approval-responded')
      expect(stateOf(r1?.parts, 'ap-b')).toBe('approval-requested')

      // The second call must re-read the row (now A=responded) and add B — NOT overwrite from a stale
      // [A:req, B:req] snapshot. So both end up responded; the returned parts drive the pending check.
      const r2 = await messageService.applyToolApprovalDecisions('anchor', [{ approvalId: 'ap-b', approved: false }])
      expect(r2?.appliedApprovalIds).toEqual(['ap-b'])
      expect(r2?.alreadySettledApprovalIds).toEqual([])
      expect(stateOf(r2?.parts, 'ap-a')).toBe('approval-responded')
      expect(stateOf(r2?.parts, 'ap-b')).toBe('approval-responded')

      const committed = await messageService.getById('anchor')
      expect(stateOf(committed.data.parts, 'ap-a')).toBe('approval-responded')
      expect(stateOf(committed.data.parts, 'ap-b')).toBe('approval-responded')
    })

    it('returns null for a missing anchor (stale click on a deleted message)', async () => {
      await seedAnchorWithTwoApprovals()
      expect(
        await messageService.applyToolApprovalDecisions('gone', [{ approvalId: 'ap-a', approved: true }])
      ).toBeNull()
    })

    it('leaves the row untouched for an overlay-only decision (target part not on the row)', async () => {
      await seedAnchorWithTwoApprovals()
      const before = await messageService.getById('anchor')
      const res = await messageService.applyToolApprovalDecisions('anchor', [
        { approvalId: 'not-on-row', approved: true }
      ])
      expect(res).not.toBeNull()
      const after = await messageService.getById('anchor')
      expect(after.updatedAt).toBe(before.updatedAt) // no write performed
      expect(res?.parts).toEqual(before.data.parts)
      expect(res?.appliedApprovalIds).toEqual([])
      expect(res?.alreadySettledApprovalIds).toEqual([])
      expect(stateOf(after.data.parts, 'ap-a')).toBe('approval-requested')
    })

    it('reports already-settled decisions so stale duplicate clicks do not re-dispatch', async () => {
      await seedAnchorWithTwoApprovals()
      await messageService.applyToolApprovalDecisions('anchor', [{ approvalId: 'ap-a', approved: true }])

      const duplicate = await messageService.applyToolApprovalDecisions('anchor', [
        { approvalId: 'ap-a', approved: false }
      ])

      expect(duplicate?.appliedApprovalIds).toEqual([])
      expect(duplicate?.alreadySettledApprovalIds).toEqual(['ap-a'])
      expect(stateOf(duplicate?.parts, 'ap-a')).toBe('approval-responded')
    })
  })
})
