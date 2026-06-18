// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/TopicService'

import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { messageService } from '@data/services/MessageService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { DataApiError, ErrorCode } from '@shared/data/api'
import { CreateMessageSchema } from '@shared/data/api/schemas/messages'
import { type MessageData, type MessageRole, toContentRole } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { rootRow, setupTestDatabase, withRoot } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { and, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

function mainText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] }
}

function partsText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] as MessageData['parts'] }
}

function partsCode(content: string): MessageData {
  return { parts: [{ type: 'data-code', data: { content, language: 'ts' } }] as MessageData['parts'] }
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
    await dbh.db.insert(messageTable).values(withRoot('topic-1', messages))
  }

  describe('findPendingAssistantMessageIds', () => {
    it('returns only non-deleted assistant rows still in pending', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-p', activeNodeId: 'm-pending', orderKey: 'b0' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-p', [
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
      )

      const pendingIds = await messageService.findPendingAssistantMessageIds()
      expect(pendingIds).toEqual(['m-pending'])
    })
  })

  describe('markMessagesError', () => {
    async function seedStatuses() {
      await dbh.db.insert(topicTable).values({ id: 'topic-e', activeNodeId: 'm-a', orderKey: 'c0' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-e', [
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
      )
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

    it('returns rooted path with non-null parentId for every item', async () => {
      await seedMultiModelTree()

      const result = await messageService.getBranchMessages('topic-1', { includeSiblings: false })

      // The virtual root is excluded from the path, so every returned item — including
      // the first-turn head — has a non-null parentId.
      for (const item of result.items) {
        expect(item.message.parentId).toEqual(expect.any(String))
      }
    })

    it('rejects an explicit node outside the requested topic', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'topic-1', activeNodeId: null, orderKey: 'a0' },
        { id: 'topic-2', activeNodeId: 'other-node', orderKey: 'a1' }
      ])
      await dbh.db.insert(messageTable).values(
        withRoot('topic-2', [
          {
            id: 'other-node',
            parentId: null,
            topicId: 'topic-2',
            role: 'user',
            data: mainText('other'),
            status: 'success',
            siblingsGroupId: 0
          }
        ])
      )

      await expect(messageService.getBranchMessages('topic-1', { nodeId: 'other-node' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('search', () => {
    it('searches v2 parts text and returns message snippets', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-search', activeNodeId: 'm-search-1', orderKey: 's0' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-search', [
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
      )

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
      await dbh.db.insert(messageTable).values(
        withRoot('topic-substring', [
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
      )

      const result = await messageService.search({ q: 'needle' })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-substring-2', 'm-substring-1'])
    })

    it('requires all search terms to match a message', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-search-and', activeNodeId: 'm-search-and-2', orderKey: 'sa0' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-search-and', [
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
      )

      const result = await messageService.search({ q: 'alpha needle' })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-search-and-1'])
    })

    it('treats LIKE wildcards as literal search text after FTS prefiltering', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-search-literal', activeNodeId: 'm-search-literal-2', orderKey: 'sl0' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-search-literal', [
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
      )

      const percentResult = await messageService.search({ q: '50%' })
      const underscoreResult = await messageService.search({ q: '50_' })

      expect(percentResult.items.map((item) => item.messageId)).toEqual(['m-search-literal-1'])
      expect(underscoreResult.items.map((item) => item.messageId)).toEqual(['m-search-literal-3'])
    })

    it('uses the message FTS index as the search candidate source', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-fts-candidate', activeNodeId: 'm-fts-candidate', orderKey: 'sf0' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-fts-candidate', [
          {
            id: 'm-fts-candidate',
            parentId: null,
            topicId: 'topic-fts-candidate',
            role: 'assistant',
            data: partsText('needle exists in the base message text.'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 100,
            updatedAt: 100
          }
        ])
      )

      const ftsRow = await dbh.client.execute({
        sql: 'SELECT fts_rowid, searchable_text FROM message WHERE id = ?',
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
      await dbh.db.insert(messageTable).values(
        withRoot('topic-substring-default', [
          {
            id: 'm-substring-default',
            parentId: null,
            topicId: 'topic-substring-default',
            role: 'assistant',
            data: partsText('abcneedledef is embedded in a larger token.'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 100,
            updatedAt: 100
          }
        ])
      )

      const result = await messageService.search({ q: 'needle' })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-substring-default'])
    })

    it('filters substring search by topic id', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'topic-substring-filter', activeNodeId: 'm-substring-filter-target', orderKey: 'sf0' },
        { id: 'topic-substring-other', activeNodeId: 'm-substring-filter-other', orderKey: 'sf1' }
      ])
      await dbh.db.insert(messageTable).values([
        ...withRoot('topic-substring-filter', [
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
          }
        ]),
        ...withRoot('topic-substring-other', [
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
      await dbh.db.insert(messageTable).values(
        withRoot('topic-created-substring', [
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
      )

      const result = await messageService.search({
        q: 'needle',
        createdAtFrom: '1970-01-01T00:00:00.250Z'
      })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-created-new'])
    })

    it('orders matches by newest message before applying limit', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-order', activeNodeId: 'm-order-new', orderKey: 's2' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-order', [
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
      )

      const result = await messageService.search({ q: 'needle', limit: 1 })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-order-new'])
    })

    it('searches visible code parts', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-code', activeNodeId: 'm-code-1', orderKey: 's4' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-code', [
          {
            id: 'm-code-1',
            parentId: null,
            topicId: 'topic-code',
            role: 'assistant',
            data: partsCode('const searchableCodeNeedle = true'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 100,
            updatedAt: 100
          }
        ])
      )

      const result = await messageService.search({ q: 'searchableCodeNeedle' })

      expect(result.items.map((item) => item.messageId)).toEqual(['m-code-1'])
      expect(result.items[0].snippet).toContain('searchableCodeNeedle')
    })

    it('uses message id as the cursor tiebreaker when createdAt values match', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-page-tie', activeNodeId: 'm-page-tie-3', orderKey: 'st0' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-page-tie', [
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
      )

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
      await dbh.db.insert(messageTable).values(
        withRoot('topic-page', [
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
      )

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
      expect(rootNode?.parentId).toBe('vroot-topic-1')
      expect(followNode?.parentId).toBe('m-a2')

      // Regression: preview is derived from data.parts text (was always '' when it read data.blocks).
      expect(rootNode?.preview).toBe('hi')
      expect(followNode?.preview).toBe('follow up')
    })

    it('uses v2 parts text for tree node preview', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-preview', activeNodeId: 'm-preview', orderKey: 'preview' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-preview', [
          {
            id: 'm-preview',
            parentId: null,
            topicId: 'topic-preview',
            role: 'assistant',
            data: partsText('The v2 parts payload should be visible in the tree preview.'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 100,
            updatedAt: 100
          }
        ])
      )

      const result = await messageService.getTree('topic-preview', { depth: -1 })

      expect(result.nodes.find((node) => node.id === 'm-preview')?.preview).toContain('v2 parts payload')
    })

    it('returns every same-topic root tree even when roots are not in a sibling group', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-multi-root', activeNodeId: 'a-second', orderKey: 'roots' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-multi-root', [
          {
            id: 'u-first',
            parentId: null,
            topicId: 'topic-multi-root',
            role: 'user',
            data: mainText('first root'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 100,
            updatedAt: 100
          },
          {
            id: 'a-first',
            parentId: 'u-first',
            topicId: 'topic-multi-root',
            role: 'assistant',
            data: mainText('first answer'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 200,
            updatedAt: 200
          },
          {
            id: 'u-second',
            parentId: null,
            topicId: 'topic-multi-root',
            role: 'user',
            data: mainText('second root'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 300,
            updatedAt: 300
          },
          {
            id: 'a-second',
            parentId: 'u-second',
            topicId: 'topic-multi-root',
            role: 'assistant',
            data: mainText('second answer'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 400,
            updatedAt: 400
          }
        ])
      )

      const result = await messageService.getTree('topic-multi-root', { depth: -1 })

      expect(result.siblingsGroups).toHaveLength(0)
      expect(result.nodes.map((node) => [node.id, node.parentId])).toEqual([
        ['u-first', 'vroot-topic-multi-root'],
        ['a-first', 'u-first'],
        ['u-second', 'vroot-topic-multi-root'],
        ['a-second', 'u-second']
      ])
      expect(result.activeNodeId).toBe('a-second')
    })
  })

  describe('createSibling', () => {
    it('creates first-turn user siblings under the virtual root for edit and resend', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-root-sibling', activeNodeId: 'u-root', orderKey: 's0' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-root-sibling', [
          {
            id: 'u-root',
            topicId: 'topic-root-sibling',
            parentId: null,
            role: 'user',
            data: mainText('root prompt'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 100,
            updatedAt: 100
          }
        ])
      )
      const virtualRootId = 'vroot-topic-root-sibling'
      const beforeWriteTx = MockMainDbServiceUtils.getMockCallCounts().withWriteTx

      const sibling = await messageService.createSibling('u-root', mainText('edited root prompt'))

      // The source first-turn message hangs off the virtual root, so the new
      // sibling is an ordinary sibling under that same parent — no special root case.
      const contentRows = await dbh.db
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.topicId, 'topic-root-sibling'), eq(messageTable.parentId, virtualRootId)))
      expect(contentRows).toHaveLength(2)
      expect(sibling.role).toBe('user')
      expect(sibling.parentId).toBe(virtualRootId)
      expect(sibling.status).toBe('success')
      expect(sibling.siblingsGroupId).toBeGreaterThan(0)
      expect(contentRows.every((message) => message.siblingsGroupId === sibling.siblingsGroupId)).toBe(true)

      const [topic] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 'topic-root-sibling')).limit(1)
      expect(topic.activeNodeId).toBe(sibling.id)
      expect(MockMainDbServiceUtils.getMockCallCounts().withWriteTx).toBe(beforeWriteTx + 1)

      const branch = await messageService.getBranchMessages('topic-root-sibling', { includeSiblings: true })
      expect(branch.items).toHaveLength(1)
      expect(branch.items[0].message.id).toBe(sibling.id)
      expect(branch.items[0].siblingsGroup?.map((message) => message.id)).toEqual(['u-root'])

      // The first-turn group's parentId is the topic's virtual root (never re-nulled).
      const tree = await messageService.getTree('topic-root-sibling', { depth: -1 })
      expect(tree.siblingsGroups).toHaveLength(1)
      expect(tree.siblingsGroups[0].parentId).toBe(virtualRootId)
      expect(tree.siblingsGroups[0].nodes.map((node) => node.id)).toEqual(['u-root', sibling.id])
    })

    it('returns first-turn sibling branches with each subtree for the branch flow canvas', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-root-flow', activeNodeId: 'a-original', orderKey: 's1' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-root-flow', [
          {
            id: 'u-original',
            topicId: 'topic-root-flow',
            parentId: null,
            role: 'user',
            data: mainText('original root prompt'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 100,
            updatedAt: 100
          },
          {
            id: 'a-original',
            topicId: 'topic-root-flow',
            parentId: 'u-original',
            role: 'assistant',
            data: mainText('original answer'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 200,
            updatedAt: 200
          }
        ])
      )

      const editedRoot = await messageService.createSibling('u-original', mainText('edited root prompt'))
      // The new first-turn sibling shares the virtual root as its parent.
      expect(editedRoot.parentId).toBe('vroot-topic-root-flow')
      await dbh.db.insert(messageTable).values({
        id: 'a-edited',
        topicId: 'topic-root-flow',
        parentId: editedRoot.id,
        role: 'assistant',
        data: mainText('edited answer'),
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 300,
        updatedAt: 300
      })
      await dbh.db.update(topicTable).set({ activeNodeId: 'a-edited' }).where(eq(topicTable.id, 'topic-root-flow'))

      const tree = await messageService.getTree('topic-root-flow', { depth: -1 })

      expect(tree.activeNodeId).toBe('a-edited')
      expect(tree.siblingsGroups).toHaveLength(1)
      // First-turn group's parentId is the topic's virtual root.
      expect(tree.siblingsGroups[0].parentId).toBe('vroot-topic-root-flow')
      expect(tree.siblingsGroups[0].nodes.map((node) => [node.id, node.hasChildren])).toEqual([
        ['u-original', true],
        [editedRoot.id, true]
      ])
      expect(tree.nodes.map((node) => [node.id, node.parentId])).toEqual([
        ['a-original', 'u-original'],
        ['a-edited', editedRoot.id]
      ])
    })

    it('marks edited non-root user siblings as success so branch flow does not show the user node as loading', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-sibling-status', activeNodeId: 'u-follow', orderKey: 's0' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-sibling-status', [
          {
            id: 'u-root',
            topicId: 'topic-sibling-status',
            parentId: null,
            role: 'user',
            data: mainText('original prompt'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 100,
            updatedAt: 100
          },
          {
            id: 'a-root',
            topicId: 'topic-sibling-status',
            parentId: 'u-root',
            role: 'assistant',
            data: mainText('original answer'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 200,
            updatedAt: 200
          },
          {
            id: 'u-follow',
            topicId: 'topic-sibling-status',
            parentId: 'a-root',
            role: 'user',
            data: mainText('follow up'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 300,
            updatedAt: 300
          }
        ])
      )

      const beforeWriteTx = MockMainDbServiceUtils.getMockCallCounts().withWriteTx

      const sibling = await messageService.createSibling('u-follow', mainText('edited follow up'))

      expect(sibling.role).toBe('user')
      expect(sibling.parentId).toBe('a-root')
      expect(sibling.status).toBe('success')
      expect(MockMainDbServiceUtils.getMockCallCounts().withWriteTx).toBe(beforeWriteTx + 1)

      const [topic] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 'topic-sibling-status')).limit(1)
      expect(topic.activeNodeId).toBe(sibling.id)
    })
  })

  describe('getPathToNode — regression for raw SQL casing bug', () => {
    it('returns ancestors root-to-node with non-undefined parentId chain', async () => {
      await seedMultiModelTree()

      const path = await messageService.getPathToNode('m-follow')

      // The virtual root is excluded: the path head is the first-turn message, whose
      // parentId is the virtual-root id (never null).
      expect(path.map((m) => m.id)).toEqual(['m-root', 'm-a2', 'm-follow'])
      expect(path[0].parentId).toBe('vroot-topic-1')
      expect(path[1].parentId).toBe('m-root')
      expect(path[1].siblingsGroupId).toBe(1)
      expect(path[1].modelId).toBe(createUniqueModelId('provider-b', 'model-B'))
      expect(path[2].parentId).toBe('m-a2')
    })
  })

  describe('copyPathRowsTx', () => {
    it('reparents the path head onto the destination topic virtual root', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'source-topic', orderKey: 'a0' },
        { id: 'target-topic', orderKey: 'a1' }
      ])
      // Source: virtual root → first-turn message → child. Target only has its virtual root.
      await dbh.db.insert(messageTable).values(
        withRoot('source-topic', [
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
      )
      const targetRootId = await messageService.createRootMessageTx(dbh.db, 'target-topic')

      // getPathRowsToNodeTx excludes the virtual root, so the chain starts at the first-turn head.
      const pathRows = await messageService.getPathRowsToNodeTx(dbh.db, 'source-child', { topicId: 'source-topic' })
      expect(pathRows.map((r) => r.id)).toEqual(['source-root', 'source-child'])

      const { copiedActiveNodeId } = await dbh.db.transaction((tx) =>
        messageService.copyPathRowsTx(tx, pathRows, { topicId: 'target-topic' })
      )

      // The destination keeps a single virtual root; the copied head hangs off it,
      // and the rest of the path chains onto the head.
      const targetContent = await dbh.db
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.topicId, 'target-topic'), eq(messageTable.parentId, targetRootId)))
      expect(targetContent).toHaveLength(1)
      expect(targetContent[0].data.parts?.[0]).toEqual({ type: 'text', text: 'root' })

      const copiedLeaf = await dbh.db.select().from(messageTable).where(eq(messageTable.id, copiedActiveNodeId))
      expect(copiedLeaf[0].parentId).toBe(targetContent[0].id)
      expect(copiedLeaf[0].data.parts?.[0]).toEqual({ type: 'text', text: 'child' })
    })
  })

  describe('virtual root — single-root invariant', () => {
    it('getRootMessageIdTx throws for a topic with no virtual root', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-noroot', orderKey: 'a0' })

      await expect(messageService.getRootMessageIdTx(dbh.db, 'topic-noroot')).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })
    })

    it('a second createRootMessageTx on the same topic violates message_topic_root_uniq', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-dupe-root', orderKey: 'a0' })
      const firstRootId = await messageService.createRootMessageTx(dbh.db, 'topic-dupe-root')

      // The partial unique index (message_topic_root_uniq) rejects the second root insert.
      await expect(messageService.createRootMessageTx(dbh.db, 'topic-dupe-root')).rejects.toMatchObject({
        cause: { code: 'SQLITE_CONSTRAINT_UNIQUE' }
      })

      // getRootMessageIdTx still resolves the single surviving root.
      expect(await messageService.getRootMessageIdTx(dbh.db, 'topic-dupe-root')).toBe(firstRootId)
      const rootRows = await dbh.db
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.topicId, 'topic-dupe-root'), isNull(messageTable.parentId)))
      expect(rootRows).toHaveLength(1)
    })

    it('createRootMessageTx inserts a content-less role=root virtual root', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-root-shape', orderKey: 'a0' })
      const rootId = await messageService.createRootMessageTx(dbh.db, 'topic-root-shape')

      const [root] = await dbh.db.select().from(messageTable).where(eq(messageTable.id, rootId))
      expect(root.parentId).toBeNull()
      expect(root.role).toBe('root')
      expect(root.data).toEqual({ parts: [] })
      expect(root.status).toBe('success')
      expect(root.siblingsGroupId).toBe(0)
    })

    it('a role-filtered content query (role = system) excludes the virtual root', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-role-query', orderKey: 'a0' })
      const rootId = await messageService.createRootMessageTx(dbh.db, 'topic-role-query')
      // A real system-prompt content message hanging off the virtual root.
      const systemMsg = await messageService.create('topic-role-query', {
        role: 'system',
        parentId: null,
        data: mainText('you are a helpful assistant'),
        status: 'success'
      })

      // The dedicated role = 'root' means a plain `WHERE role = 'system'` lookup
      // returns content rows only — no `parentId IS NOT NULL` caveat needed.
      const systemRows = await dbh.db
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.topicId, 'topic-role-query'), eq(messageTable.role, 'system')))
      expect(systemRows.map((r) => r.id)).toEqual([systemMsg.id])
      expect(systemRows.some((r) => r.id === rootId)).toBe(false)
    })
  })

  describe('create — first-turn resolution', () => {
    it('two parentId:null creates become first-turn siblings under the SAME virtual root', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-first', activeNodeId: null, orderKey: 'a0' })
      const rootId = await messageService.createRootMessageTx(dbh.db, 'topic-first')

      // setAsActive:false so the second create still auto-resolves to the root (not the first message).
      const first = await messageService.create('topic-first', {
        role: 'user',
        parentId: null,
        data: mainText('first'),
        status: 'success',
        setAsActive: false
      })
      const second = await messageService.create('topic-first', {
        role: 'user',
        parentId: null,
        data: mainText('resend'),
        status: 'success',
        setAsActive: false
      })

      expect(first.parentId).toBe(rootId)
      expect(second.parentId).toBe(rootId)

      // Exactly one physical root row; the two first-turn messages hang off it.
      const rootRows = await dbh.db
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.topicId, 'topic-first'), isNull(messageTable.parentId)))
      expect(rootRows.map((r) => r.id)).toEqual([rootId])
      const children = await dbh.db
        .select({ id: messageTable.id })
        .from(messageTable)
        .where(eq(messageTable.parentId, rootId))
      expect(children.map((c) => c.id).sort()).toEqual([first.id, second.id].sort())
    })

    it('parentId:undefined on an empty topic resolves to the virtual root', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-auto', activeNodeId: null, orderKey: 'a0' })
      const rootId = await messageService.createRootMessageTx(dbh.db, 'topic-auto')

      const message = await messageService.create('topic-auto', {
        role: 'user',
        data: mainText('hi'),
        status: 'success'
      })

      expect(message.parentId).toBe(rootId)
    })
  })

  describe('delete — virtual root guard', () => {
    const virtualRootId = 'vroot-topic-1'

    it('rejects deleting the virtual root with cascade=false', async () => {
      await seedMultiModelTree()

      await expect(messageService.delete(virtualRootId, false)).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })

      const roots = await dbh.db
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.topicId, 'topic-1'), isNull(messageTable.parentId)))
      expect(roots.map((r) => r.id)).toEqual([virtualRootId])
    })

    it('rejects deleting the virtual root even with cascade=true (would leave a rootless topic)', async () => {
      await seedMultiModelTree()

      await expect(messageService.delete(virtualRootId, true)).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })

      // The whole subtree survives — nothing was cascade-deleted.
      const rows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 'topic-1'))
      expect(rows.some((r) => r.id === virtualRootId)).toBe(true)
      expect(rows.some((r) => r.id === 'm-root')).toBe(true)
    })

    it('clear-topic (cascade delete of the root’s child) leaves the virtual root intact', async () => {
      await seedMultiModelTree()

      // "Clear all messages" = delete the virtual root's children, not the root itself.
      const result = await messageService.delete('m-root', true)
      expect(result.deletedIds).toEqual(expect.arrayContaining(['m-root', 'm-a1', 'm-a2', 'm-follow']))

      const remaining = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 'topic-1'))
      expect(remaining.map((r) => r.id)).toEqual([virtualRootId])
      expect(remaining[0].role).toBe('root')
      expect(remaining[0].parentId).toBeNull()
    })

    it('clearTopicMessages removes every content message, keeps the virtual root, and clears activeNodeId', async () => {
      await seedMultiModelTree() // root + m-root/m-a1/m-a2/m-follow, activeNodeId='m-follow'

      const result = await messageService.clearTopicMessages('topic-1')
      expect(result.deletedIds.slice().sort()).toEqual(['m-a1', 'm-a2', 'm-follow', 'm-root'])

      const remaining = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 'topic-1'))
      expect(remaining.map((r) => r.id)).toEqual([virtualRootId])
      const [topicRow] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 'topic-1'))
      expect(topicRow.activeNodeId).toBeNull()
    })

    it('clearTopicMessages on an empty topic is a no-op that keeps the root', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-empty', activeNodeId: null, orderKey: 'a0' })
      await messageService.createRootMessageTx(dbh.db, 'topic-empty')

      const result = await messageService.clearTopicMessages('topic-empty')
      expect(result.deletedIds).toEqual([])
      const rows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 'topic-empty'))
      expect(rows).toHaveLength(1)
      expect(rows[0].role).toBe('root')
    })

    it('cascade-deleting the active first-turn subtree clears activeNodeId (never points it at the root)', async () => {
      await seedMultiModelTree() // topic.activeNodeId = 'm-follow', inside m-root's subtree

      // m-root's parent is the virtual root, so the 'parent' fallback must resolve to
      // null — not the root id, which is never a valid active node.
      const result = await messageService.delete('m-root', true)
      expect(result.newActiveNodeId).toBeNull()

      const [topicRow] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 'topic-1'))
      expect(topicRow.activeNodeId).toBeNull()
    })

    it('non-cascade delete of a first-turn message splices its children onto the virtual root', async () => {
      await seedMultiModelTree()

      // m-root is a first-turn message (parent = virtual root). Splicing it out reparents
      // its replies onto the root — structurally valid (they become first-turn nodes).
      const result = await messageService.delete('m-root', false)
      expect(result.deletedIds).toEqual(['m-root'])
      expect(result.reparentedIds?.slice().sort()).toEqual(['m-a1', 'm-a2'])

      const rows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 'topic-1'))
      const byId = new Map(rows.map((r) => [r.id, r]))
      expect(byId.has('m-root')).toBe(false)
      expect(byId.get('m-a1')?.parentId).toBe('vroot-topic-1')
      expect(byId.get('m-a2')?.parentId).toBe('vroot-topic-1')
      // Exactly one null-parent row (the virtual root) remains.
      expect(rows.filter((r) => r.parentId === null).map((r) => r.id)).toEqual(['vroot-topic-1'])
    })

    it('non-cascade delete reparents children to the real parent (linear splice)', async () => {
      await seedMultiModelTree()

      // m-a2 is mid-conversation (parent = m-root); its child m-follow reparents to m-root.
      const result = await messageService.delete('m-a2', false)
      expect(result.deletedIds).toEqual(['m-a2'])
      expect(result.reparentedIds).toEqual(['m-follow'])

      const [follow] = await dbh.db.select().from(messageTable).where(eq(messageTable.id, 'm-follow'))
      expect(follow.parentId).toBe('m-root')
    })

    it('reparent rebases a moved group id so it cannot merge with an unrelated group at the destination', async () => {
      // u1 → { x(g=0), y(g=5) };  x → { c1(g=5), c2(g=5) }
      // Deleting x moves c1/c2 to u1, where group 5 already belongs to the unrelated y.
      await dbh.db.insert(topicTable).values({ id: 'topic-rebase', activeNodeId: 'c1', orderKey: 'a0' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-rebase', [
          {
            id: 'u1',
            parentId: null,
            topicId: 'topic-rebase',
            role: 'user',
            data: mainText('q'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 10,
            updatedAt: 10
          },
          {
            id: 'x',
            parentId: 'u1',
            topicId: 'topic-rebase',
            role: 'assistant',
            data: mainText('x'),
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 20,
            updatedAt: 20
          },
          {
            id: 'y',
            parentId: 'u1',
            topicId: 'topic-rebase',
            role: 'assistant',
            data: mainText('y'),
            status: 'success',
            siblingsGroupId: 5,
            createdAt: 21,
            updatedAt: 21
          },
          {
            id: 'c1',
            parentId: 'x',
            topicId: 'topic-rebase',
            role: 'user',
            data: mainText('c1'),
            status: 'success',
            siblingsGroupId: 5,
            createdAt: 30,
            updatedAt: 30
          },
          {
            id: 'c2',
            parentId: 'x',
            topicId: 'topic-rebase',
            role: 'user',
            data: mainText('c2'),
            status: 'success',
            siblingsGroupId: 5,
            createdAt: 31,
            updatedAt: 31
          }
        ])
      )

      await messageService.delete('x', false)

      const rows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 'topic-rebase'))
      const byId = new Map(rows.map((r) => [r.id, r]))
      expect(byId.get('c1')?.parentId).toBe('u1')
      expect(byId.get('c2')?.parentId).toBe('u1')
      expect(byId.get('c1')?.siblingsGroupId).toBe(byId.get('c2')?.siblingsGroupId)
      expect(byId.get('c1')?.siblingsGroupId).not.toBe(5)
      expect(byId.get('y')?.siblingsGroupId).toBe(5)
    })
  })

  describe('rootId — authoritative first-turn signal', () => {
    it('getBranchMessages returns the virtual-root id; first turn = parentId === rootId', async () => {
      await seedMultiModelTree()
      const res = await messageService.getBranchMessages('topic-1', { nodeId: 'm-follow' })
      expect(res.rootId).toBe('vroot-topic-1')
      // m-root is the first turn — its parentId equals rootId; m-follow (deeper) does not.
      const root = res.items.find((i) => i.message.id === 'm-root')
      const follow = res.items.find((i) => i.message.id === 'm-follow')
      expect(root?.message.parentId).toBe(res.rootId)
      expect(follow?.message.parentId).not.toBe(res.rootId)
    })

    it('getTree returns the virtual-root id', async () => {
      await seedMultiModelTree()
      const tree = await messageService.getTree('topic-1', { depth: -1 })
      expect(tree.rootId).toBe('vroot-topic-1')
    })
  })

  describe('sentinel-boundary guards', () => {
    const virtualRootId = 'vroot-topic-1'

    it('createSibling rejects the virtual root (no second null-parent row)', async () => {
      await seedMultiModelTree()
      await expect(messageService.createSibling(virtualRootId, mainText('x'))).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })
    })

    it('getTree rejects an explicit rootId that is the virtual root', async () => {
      await seedMultiModelTree()
      await expect(messageService.getTree('topic-1', { rootId: virtualRootId })).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })
    })

    it('update rejects reparenting a content message to the virtual-root slot (parentId=null)', async () => {
      await seedMultiModelTree()
      await expect(messageService.update('m-a2', { parentId: null })).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })
    })

    it('update rejects reparenting the virtual root', async () => {
      await seedMultiModelTree()
      await expect(messageService.update(virtualRootId, { parentId: 'm-root' })).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })
    })

    it('CreateMessageSchema rejects role="root" at validation', () => {
      const result = CreateMessageSchema.safeParse({ role: 'root', data: { parts: [] }, status: 'success' })
      expect(result.success).toBe(false)
    })

    it('toContentRole passes content roles through and throws on the root sentinel', () => {
      expect(toContentRole('user')).toBe('user')
      expect(toContentRole('assistant')).toBe('assistant')
      expect(toContentRole('system')).toBe('system')
      expect(() => toContentRole('root')).toThrow()
    })

    it('getPathRowsToNodeTx excludes the root, so a built history never carries role=root (toContentRole safe)', async () => {
      await seedMultiModelTree()
      const rows = await messageService.getPathRowsToNodeTx(dbh.db, 'm-follow', { topicId: 'topic-1' })
      // Path excludes the virtual root → no role='root' reaches serialization.
      expect(rows.every((r) => r.role !== 'root')).toBe(true)
      expect(() => rows.map((r) => toContentRole(r.role as MessageRole))).not.toThrow()
    })

    it('a soft-deleted virtual root does not collide with a freshly created one (hardened index)', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-sd', activeNodeId: null, orderKey: 'a0' })
      const firstRoot = await messageService.createRootMessageTx(dbh.db, 'topic-sd')
      // Soft-delete the root, then create a new one — the partial unique index is scoped to
      // deleted_at IS NULL, so this must not raise SQLITE_CONSTRAINT_UNIQUE.
      await dbh.db.update(messageTable).set({ deletedAt: 999 }).where(eq(messageTable.id, firstRoot))
      const secondRoot = await messageService.createRootMessageTx(dbh.db, 'topic-sd')

      expect(secondRoot).not.toBe(firstRoot)
      // getRootMessageIdTx resolves the live one, not the soft-deleted row.
      expect(await messageService.getRootMessageIdTx(dbh.db, 'topic-sd')).toBe(secondRoot)
    })
  })

  describe('getPathRowsToNodeTx — excludes virtual root', () => {
    it('returns a path whose head is the first-turn message (parentId = virtual root, never null)', async () => {
      await seedMultiModelTree()

      const rows = await messageService.getPathRowsToNodeTx(dbh.db, 'm-follow', { topicId: 'topic-1' })

      expect(rows.map((r) => r.id)).toEqual(['m-root', 'm-a2', 'm-follow'])
      // The virtual root is excluded; the head retains its real (non-null) parentId.
      expect(rows[0].parentId).toBe('vroot-topic-1')
      expect(rows.some((r) => r.parentId === null)).toBe(false)
    })
  })

  describe('getTree — keeps first-turn parentId on the virtual root', () => {
    it('surfaces first-turn nodes with parentId set to the virtual root, which is not itself a node', async () => {
      await seedMultiModelTree()

      const result = await messageService.getTree('topic-1', { depth: -1 })

      // m-root hangs off vroot-topic-1, and the response keeps that real parent.
      const rootNode = result.nodes.find((n) => n.id === 'm-root')
      expect(rootNode?.parentId).toBe('vroot-topic-1')
      // The virtual root is never surfaced as a node.
      expect(result.nodes.some((n) => n.id === 'vroot-topic-1')).toBe(false)
    })

    it('first-turn SiblingsGroup.parentId is the virtual root', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-first-group', activeNodeId: 'u-b', orderKey: 'fg0' })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-first-group', [
          {
            id: 'u-a',
            parentId: null,
            topicId: 'topic-first-group',
            role: 'user',
            data: mainText('v1'),
            status: 'success',
            siblingsGroupId: 9,
            createdAt: 100,
            updatedAt: 100
          },
          {
            id: 'u-b',
            parentId: null,
            topicId: 'topic-first-group',
            role: 'user',
            data: mainText('v2'),
            status: 'success',
            siblingsGroupId: 9,
            createdAt: 200,
            updatedAt: 200
          }
        ])
      )

      const result = await messageService.getTree('topic-first-group', { depth: -1 })

      expect(result.siblingsGroups).toHaveLength(1)
      expect(result.siblingsGroups[0].parentId).toBe('vroot-topic-first-group')
      expect(result.siblingsGroups[0].siblingsGroupId).toBe(9)
      expect(result.siblingsGroups[0].nodes.map((n) => n.id)).toEqual(['u-a', 'u-b'])
    })
  })

  describe('createUserMessageWithPlaceholders — placeholder id override', () => {
    it('uses the caller-supplied id when provided, generates otherwise', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-res', activeNodeId: null, orderKey: 'a0' })
      await messageService.createRootMessageTx(dbh.db, 'topic-res')

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
      // Every topic owns a virtual root from birth; first-turn user messages resolve to it.
      // Use the deterministic `vroot-<id>` so seeded children can reference it directly.
      await dbh.db.insert(messageTable).values(rootRow(id))
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

        // parentId:null on an empty topic resolves to the virtual root, not a physical root.
        expect(userMessage.parentId).toBe('vroot-topic-1')
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
            parentId: 'vroot-topic-1',
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
            parentId: 'vroot-topic-1',
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
            parentId: 'vroot-topic-1',
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

        // Only the seeded virtual root survives — no user/placeholder rows leaked.
        const allRows = await dbh.db.select().from(messageTable)
        expect(allRows.map((r) => r.id)).toEqual(['vroot-topic-1'])
      })

      it('throws when parent does not belong to the same topic', async () => {
        await dbh.db.insert(topicTable).values([
          { id: 'topic-1', orderKey: 'a0' },
          { id: 'topic-2', orderKey: 'a1' }
        ])
        await dbh.db.insert(messageTable).values(
          withRoot('topic-2', [
            {
              id: 'u-in-t2',
              topicId: 'topic-2',
              parentId: null,
              role: 'user',
              data: mainText('other'),
              status: 'success',
              siblingsGroupId: 0
            }
          ])
        )

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
      await dbh.db.insert(messageTable).values(withRoot('topic-1', rows))
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
      await dbh.db.insert(messageTable).values(
        withRoot('topic-ap', [
          {
            id: 'anchor',
            parentId: null,
            topicId: 'topic-ap',
            role: 'assistant',
            data: { parts: [toolPart('c-a', 'ap-a'), toolPart('c-b', 'ap-b')] as MessageData['parts'] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 100,
            updatedAt: 100
          }
        ])
      )
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
