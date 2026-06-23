import { fileRefTable } from '@data/db/schemas/file'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { KnowledgeItemService } from '@data/services/KnowledgeItemService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api'
import type { CreateKnowledgeItemDto } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const KNOWLEDGE_BASE_ID = '11111111-1111-4111-8111-111111111111'
const itemId = (sequence: string) => `0198f3f2-${sequence}-7abc-8def-123456789abc`
const DIR_A_ID = itemId('7d1a')
const DIR_B_ID = itemId('7d1b')
const NOTE_1_ID = itemId('7d1c')
const ITEM_1_ID = itemId('7d1d')
const ITEM_2_ID = itemId('7d1e')
const ROOT_1_ID = itemId('7d1f')
const ROOT_2_ID = itemId('7d20')
const CHILD_1_ID = itemId('7d21')
const NOTE_A_ID = itemId('7d22')
const VISIBLE_NOTE_ID = itemId('7d23')
const DELETING_NOTE_ID = itemId('7d24')
const NOTE_OWNER_ID = itemId('7d26')
const DIR_CHILD_ID = itemId('7d30')
const DIR_ROOT_ID = itemId('7d31')
const FILE_CHILD_ID = itemId('7d40')
const NOTE_GRANDCHILD_ID = itemId('7d41')
const NOTE_ROOT_ID = itemId('7d42')
const DIR_OWNER_ID = itemId('7d45')
const CHILD_A_ID = itemId('7d46')
const CHILD_B_ID = itemId('7d47')
const OTHER_ITEM_ID = itemId('7d50')
const COMPLETED_CHILD_ID = itemId('7d52')
const DELETING_CHILD_ID = itemId('7d53')
const FILE_A_ID = itemId('7d60')
const FILE_B_ID = itemId('7d61')
const FILE_GRANDCHILD_ID = itemId('7d62')

describe('KnowledgeItemService', () => {
  const dbh = setupTestDatabase()
  let service: KnowledgeItemService

  beforeEach(async () => {
    service = new KnowledgeItemService()
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI',
      orderKey: generateOrderKeyBetween(null, null)
    })
    await dbh.db.insert(userModelTable).values({
      id: createUniqueModelId('openai', 'text-embedding-3-large'),
      providerId: 'openai',
      modelId: 'text-embedding-3-large',
      presetModelId: 'text-embedding-3-large',
      name: 'text-embedding-3-large',
      isEnabled: true,
      isHidden: false,
      orderKey: generateOrderKeyBetween(null, null)
    })
    await dbh.db.insert(knowledgeBaseTable).values({
      id: KNOWLEDGE_BASE_ID,
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: createUniqueModelId('openai', 'text-embedding-3-large'),
      status: 'completed',
      error: null,
      chunkSize: 1024,
      chunkOverlap: 200,
      searchMode: 'hybrid'
    })
  })

  async function seedItem(overrides: Partial<typeof knowledgeItemTable.$inferInsert> = {}) {
    const values: typeof knowledgeItemTable.$inferInsert = {
      baseId: KNOWLEDGE_BASE_ID,
      groupId: null,
      type: 'note',
      data: { source: 'seed-note', content: 'hello world' },
      status: 'idle',
      error: null,
      ...overrides
    }
    const [inserted] = await dbh.db.insert(knowledgeItemTable).values(values).returning()
    return inserted
  }

  function createFileItemData(id: string) {
    const slug = id.slice(0, 8)
    return {
      source: `/docs/${slug}.md`,
      relativePath: `${slug}.md`
    }
  }

  describe('list', () => {
    it('returns items for a knowledge base', async () => {
      await seedItem()

      const result = await service.list(KNOWLEDGE_BASE_ID, { limit: 20 })

      expect(result.total).toBe(1)
      expect(result.nextCursor).toBeUndefined()
      expect(result.items[0]).toMatchObject({
        baseId: KNOWLEDGE_BASE_ID,
        type: 'note',
        data: { content: 'hello world' }
      })
    })

    it('paginates with a cursor across pages without overlap', async () => {
      await seedItem({ id: ITEM_1_ID, createdAt: 3000, data: { source: 'c', content: 'c' } })
      await seedItem({ id: ITEM_2_ID, createdAt: 2000, data: { source: 'b', content: 'b' } })
      await seedItem({ id: NOTE_1_ID, createdAt: 1000, data: { source: 'a', content: 'a' } })

      const first = await service.list(KNOWLEDGE_BASE_ID, { limit: 2 })

      expect(first.total).toBe(3)
      // Newest first: createdAt DESC.
      expect(first.items.map((item) => item.id)).toEqual([ITEM_1_ID, ITEM_2_ID])
      expect(first.nextCursor).toBeDefined()

      const second = await service.list(KNOWLEDGE_BASE_ID, { limit: 2, cursor: first.nextCursor })

      expect(second.total).toBe(3)
      expect(second.items.map((item) => item.id)).toEqual([NOTE_1_ID])
      expect(second.nextCursor).toBeUndefined()
    })

    it('tiebreaks rows sharing a createdAt by id without overlap or gaps', async () => {
      // All four share a createdAt, so only the `id ASC` tiebreaker separates them — and the
      // page boundary lands *inside* that equal-createdAt run. `createdAt = Date.now()` makes
      // millisecond collisions common, so this is exactly where a wrong keyset duplicates or
      // skips a row. A small limit forces several boundaries through the tied run.
      const ids = [itemId('7d70'), itemId('7d71'), itemId('7d72'), itemId('7d73')]
      for (const id of ids) {
        await seedItem({ id, createdAt: 5000, data: { source: id, content: id } })
      }

      const seen: string[] = []
      const pageSizes: number[] = []
      let lastNextCursor: string | undefined
      let cursor: string | undefined
      for (let guard = 0; guard < 10; guard++) {
        const page = await service.list(KNOWLEDGE_BASE_ID, { limit: 2, cursor })
        expect(page.total).toBe(4)
        seen.push(...page.items.map((item) => item.id))
        pageSizes.push(page.items.length)
        lastNextCursor = page.nextCursor
        if (!page.nextCursor) break
        cursor = page.nextCursor
      }

      // Exactly once each: no overlap (a cursor re-emitting a row) and no gap (a cursor
      // skipping one). Within an equal createdAt the order is id ASC.
      expect(seen).toEqual([...ids].sort())
      // The 4 rows divide evenly into pages of `limit` (2), so the final page holds exactly `limit`
      // rows yet must still report no next cursor — the limit+1 probe finds no row past the boundary.
      expect(pageSizes).toEqual([2, 2])
      expect(lastNextCursor).toBeUndefined()
    })

    it('falls back to the first page when the cursor is malformed', async () => {
      await seedItem({ id: ITEM_1_ID, createdAt: 2000, data: { source: 'b', content: 'b' } })
      await seedItem({ id: ITEM_2_ID, createdAt: 1000, data: { source: 'a', content: 'a' } })

      const result = await service.list(KNOWLEDGE_BASE_ID, { limit: 20, cursor: 'not-a-valid-cursor' })

      expect(result.items.map((item) => item.id)).toEqual([ITEM_1_ID, ITEM_2_ID])
    })

    it('filters items by type and group', async () => {
      await seedItem({ id: DIR_A_ID, type: 'directory', data: { source: '/a' } })
      await seedItem({ id: DIR_B_ID, type: 'directory', data: { source: '/b' } })
      await seedItem({ id: NOTE_1_ID, type: 'note', groupId: DIR_A_ID, data: { source: NOTE_1_ID, content: 'n1' } })

      const directories = await service.list(KNOWLEDGE_BASE_ID, { limit: 20, type: 'directory' })
      const grouped = await service.list(KNOWLEDGE_BASE_ID, { limit: 20, groupId: DIR_A_ID })

      expect(directories.items.map((item) => item.id).sort()).toEqual([DIR_A_ID, DIR_B_ID])
      expect(grouped.items.map((item) => item.id)).toEqual([NOTE_1_ID])
    })

    it('filters root items when groupId is null', async () => {
      await seedItem({ id: DIR_A_ID, type: 'directory', data: { source: '/a' } })
      await seedItem({ id: NOTE_ROOT_ID, type: 'note', data: { source: 'root', content: 'root' } })
      await seedItem({ id: NOTE_1_ID, type: 'note', groupId: DIR_A_ID, data: { source: 'child', content: 'child' } })

      const result = await service.list(KNOWLEDGE_BASE_ID, { limit: 20, groupId: null })

      expect(result.total).toBe(2)
      expect(result.items.map((item) => item.id).sort()).toEqual([DIR_A_ID, NOTE_ROOT_ID])
    })

    it('hides deleting items', async () => {
      await seedItem({ id: VISIBLE_NOTE_ID, data: { source: 'visible', content: 'visible' } })
      await seedItem({ id: DELETING_NOTE_ID, data: { source: 'deleting', content: 'deleting' }, status: 'deleting' })

      const result = await service.list(KNOWLEDGE_BASE_ID, { limit: 20 })

      expect(result.total).toBe(1)
      expect(result.items.map((item) => item.id)).toEqual([VISIBLE_NOTE_ID])
    })
  })

  describe('getItemsByBaseId', () => {
    it('returns items in creation order for a knowledge base', async () => {
      await seedItem({
        id: ITEM_2_ID,
        data: { source: ITEM_2_ID, content: 'item 2' },
        createdAt: 20,
        updatedAt: 20
      })
      await seedItem({
        id: ITEM_1_ID,
        data: { source: ITEM_1_ID, content: 'item 1' },
        createdAt: 10,
        updatedAt: 10
      })

      const result = await service.getItemsByBaseId(KNOWLEDGE_BASE_ID)

      expect(result.map((item) => item.id)).toEqual([ITEM_1_ID, ITEM_2_ID])
      expect(result[0]).toMatchObject({
        id: ITEM_1_ID,
        baseId: KNOWLEDGE_BASE_ID,
        groupId: null,
        type: 'note',
        data: { source: ITEM_1_ID, content: 'item 1' },
        status: 'idle',
        error: null
      })
    })

    it('filters root items when groupId is null', async () => {
      await seedItem({
        id: ROOT_2_ID,
        data: { source: ROOT_2_ID, content: 'root 2' },
        createdAt: 20,
        updatedAt: 20
      })
      await seedItem({
        id: ROOT_1_ID,
        data: { source: ROOT_1_ID, content: 'root 1' },
        createdAt: 10,
        updatedAt: 10
      })
      await seedItem({
        id: CHILD_1_ID,
        groupId: ROOT_1_ID,
        data: { source: CHILD_1_ID, content: 'child 1' },
        createdAt: 15,
        updatedAt: 15
      })

      const result = await service.getItemsByBaseId(KNOWLEDGE_BASE_ID, { groupId: null })

      expect(result.map((item) => item.id)).toEqual([ROOT_1_ID, ROOT_2_ID])
    })

    it('returns root items through the explicit root helper', async () => {
      await seedItem({ id: ROOT_1_ID, data: { source: ROOT_1_ID, content: 'root 1' } })
      await seedItem({ id: CHILD_1_ID, groupId: ROOT_1_ID, data: { source: CHILD_1_ID, content: 'child 1' } })

      const result = await service.getRootItemsByBaseId(KNOWLEDGE_BASE_ID)

      expect(result.map((item) => item.id)).toEqual([ROOT_1_ID])
    })

    it('collapses selected descendants to their outermost selected roots', async () => {
      await seedItem({ id: DIR_A_ID, type: 'directory', data: { source: '/a' } })
      await seedItem({ id: NOTE_A_ID, groupId: DIR_A_ID, data: { source: 'a', content: 'a' } })
      await seedItem({ id: NOTE_ROOT_ID, data: { source: 'root', content: 'root' } })

      const result = await service.getOutermostSelectedItemIds(KNOWLEDGE_BASE_ID, [
        DIR_A_ID,
        NOTE_A_ID,
        NOTE_ROOT_ID,
        DIR_A_ID
      ])

      expect(result).toEqual([DIR_A_ID, NOTE_ROOT_ID])
    })

    it('filters items by group id', async () => {
      await seedItem({ id: DIR_A_ID, type: 'directory', data: { source: '/a' } })
      await seedItem({ id: NOTE_A_ID, groupId: DIR_A_ID, data: { source: 'a', content: 'a' } })
      await seedItem({ id: NOTE_ROOT_ID, data: { source: 'root', content: 'root' } })

      const result = await service.getItemsByBaseId(KNOWLEDGE_BASE_ID, { groupId: DIR_A_ID })

      expect(result.map((item) => item.id)).toEqual([NOTE_A_ID])
    })

    it('hides deleting items', async () => {
      await seedItem({ id: VISIBLE_NOTE_ID, data: { source: 'visible', content: 'visible' } })
      await seedItem({ id: DELETING_NOTE_ID, data: { source: 'deleting', content: 'deleting' }, status: 'deleting' })

      const result = await service.getItemsByBaseId(KNOWLEDGE_BASE_ID)

      expect(result.map((item) => item.id)).toEqual([VISIBLE_NOTE_ID])
    })

    it('throws NotFound when listing items for a missing base', async () => {
      await expect(service.getItemsByBaseId('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('getDeletingRootGroups', () => {
    it('returns top-level deleting roots grouped by base', async () => {
      await seedItem({ id: 'deleting-root-note', data: { source: 'root', content: 'root' }, status: 'deleting' })
      await seedItem({
        id: 'deleting-dir',
        type: 'directory',
        data: { source: '/deleting-dir' },
        status: 'deleting'
      })
      await seedItem({
        id: 'deleting-child',
        groupId: 'deleting-dir',
        data: { source: 'child', content: 'child' },
        status: 'deleting'
      })
      await seedItem({
        id: 'visible-dir',
        type: 'directory',
        data: { source: '/visible-dir' },
        status: 'completed'
      })
      await seedItem({
        id: 'deleting-child-of-visible',
        groupId: 'visible-dir',
        data: { source: 'visible-child', content: 'visible child' },
        status: 'deleting'
      })

      await dbh.db.insert(knowledgeBaseTable).values({
        id: 'kb-2',
        name: 'KB 2',
        dimensions: 1024,
        embeddingModelId: createUniqueModelId('openai', 'text-embedding-3-large'),
        status: 'completed',
        error: null,
        chunkSize: 1024,
        chunkOverlap: 200,
        searchMode: 'hybrid'
      })
      await seedItem({
        id: 'kb-2-deleting-root',
        baseId: 'kb-2',
        data: { source: 'kb2', content: 'kb2' },
        status: 'deleting'
      })

      await expect(service.getDeletingRootGroups()).resolves.toEqual([
        {
          baseId: KNOWLEDGE_BASE_ID,
          rootItemIds: ['deleting-child-of-visible', 'deleting-dir', 'deleting-root-note']
        },
        {
          baseId: 'kb-2',
          rootItemIds: ['kb-2-deleting-root']
        }
      ])
    })
  })

  describe('failInterruptedItems', () => {
    const INTERRUPTED = 'Indexing interrupted; reindex to finish.'
    const PREPARING_DIR = itemId('7e00')
    const PROCESSING_DIR = itemId('7e01')
    const READING_LEAF = itemId('7e02')
    const EMBEDDING_LEAF = itemId('7e03')
    const PROCESSING_LEAF = itemId('7e04')
    const IDLE_LEAF = itemId('7e05')
    const COMPLETED_LEAF = itemId('7e06')
    const FAILED_LEAF = itemId('7e07')
    const DELETING_LEAF = itemId('7e08')

    it('marks every in-flight item (leaves and containers) failed, leaving terminal/idle/deleting untouched', async () => {
      // In-flight: a container mid-expansion, a container with an in-flight child, and standalone leaves.
      await seedItem({ id: PREPARING_DIR, type: 'directory', data: { source: '/p' }, status: 'preparing' })
      await seedItem({ id: PROCESSING_DIR, type: 'directory', data: { source: '/q' }, status: 'processing' })
      await seedItem({
        id: READING_LEAF,
        groupId: PROCESSING_DIR,
        data: { source: 'r', content: 'r' },
        status: 'reading'
      })
      await seedItem({ id: EMBEDDING_LEAF, data: { source: 'e', content: 'e' }, status: 'embedding' })
      await seedItem({ id: PROCESSING_LEAF, data: { source: 'p2', content: 'p2' }, status: 'processing' })

      // Untouched: not started, already terminal, or being deleted.
      await seedItem({ id: IDLE_LEAF, data: { source: 'i', content: 'i' }, status: 'idle' })
      await seedItem({ id: COMPLETED_LEAF, data: { source: 'c', content: 'c' }, status: 'completed' })
      await seedItem({ id: FAILED_LEAF, data: { source: 'f', content: 'f' }, status: 'failed', error: 'real failure' })
      await seedItem({ id: DELETING_LEAF, data: { source: 'd', content: 'd' }, status: 'deleting' })

      const count = await service.failInterruptedItems(INTERRUPTED)
      expect(count).toBe(5)

      for (const id of [PREPARING_DIR, PROCESSING_DIR, READING_LEAF, EMBEDDING_LEAF, PROCESSING_LEAF]) {
        const item = await service.getById(id)
        expect(item.status).toBe('failed')
        expect(item.error).toBe(INTERRUPTED)
      }

      expect((await service.getById(IDLE_LEAF)).status).toBe('idle')
      expect((await service.getById(COMPLETED_LEAF)).status).toBe('completed')
      const realFailure = await service.getById(FAILED_LEAF)
      expect(realFailure.status).toBe('failed')
      expect(realFailure.error).toBe('real failure')
      expect((await service.getById(DELETING_LEAF)).status).toBe('deleting')
    })

    it('returns 0 when nothing is in flight', async () => {
      await seedItem({ id: COMPLETED_LEAF, data: { source: 'c', content: 'c' }, status: 'completed' })
      await expect(service.failInterruptedItems(INTERRUPTED)).resolves.toBe(0)
    })

    it('rejects a blank failure reason', async () => {
      await seedItem({ id: EMBEDDING_LEAF, data: { source: 'e', content: 'e' }, status: 'embedding' })
      await expect(service.failInterruptedItems('   ')).rejects.toThrow()
      expect((await service.getById(EMBEDDING_LEAF)).status).toBe('embedding')
    })
  })

  describe('create', () => {
    it('creates one knowledge item as idle', async () => {
      const item: CreateKnowledgeItemDto = {
        type: 'directory',
        data: { source: '/tmp/files' }
      }

      const result = await service.create(KNOWLEDGE_BASE_ID, item)

      expect(result).toMatchObject({
        baseId: KNOWLEDGE_BASE_ID,
        groupId: null,
        type: 'directory',
        status: 'idle',
        error: null,
        data: item.data
      })
    })

    it('accepts a group owner in the same base', async () => {
      await seedItem({ id: DIR_A_ID, type: 'directory', data: { source: '/a' } })

      const result = await service.create(KNOWLEDGE_BASE_ID, {
        groupId: DIR_A_ID,
        type: 'note',
        data: { source: 'new grouped note', content: 'new grouped note' }
      })

      expect(result).toMatchObject({
        baseId: KNOWLEDGE_BASE_ID,
        groupId: DIR_A_ID,
        type: 'note'
      })
    })

    it('rejects deleting group owners', async () => {
      await seedItem({
        id: DIR_A_ID,
        type: 'directory',
        data: { source: '/a' },
        status: 'deleting'
      })

      await expect(
        service.create(KNOWLEDGE_BASE_ID, {
          groupId: DIR_A_ID,
          type: 'note',
          data: { source: 'child note', content: 'child note' }
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            groupId: [`Knowledge item group owner is being deleted: ${DIR_A_ID}`]
          }
        }
      })
    })

    it('rejects leaf items as group owners', async () => {
      await seedItem({ id: NOTE_OWNER_ID, type: 'note', data: { source: 'owner', content: 'owner' } })

      await expect(
        service.create(KNOWLEDGE_BASE_ID, {
          groupId: NOTE_OWNER_ID,
          type: 'note',
          data: { source: 'child note', content: 'child note' }
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            groupId: [`Knowledge item group owner must be a directory: ${NOTE_OWNER_ID}`]
          }
        }
      })
    })

    it('rejects blank group owner ids before hitting foreign key constraints', async () => {
      await expect(
        service.create(KNOWLEDGE_BASE_ID, {
          groupId: '   ',
          type: 'note',
          data: { source: 'child note', content: 'child note' }
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            groupId: ['Knowledge item group owner id is required when groupId is provided']
          }
        }
      })
    })

    it('translates missing base and missing group owner constraints', async () => {
      await expect(
        service.create('missing-base', { type: 'note', data: { source: 'note', content: 'note' } })
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })

      await expect(
        service.create(KNOWLEDGE_BASE_ID, {
          groupId: 'missing-owner',
          type: 'note',
          data: { source: 'child note', content: 'child note' }
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            groupId: [`Knowledge item group owner not found in base '${KNOWLEDGE_BASE_ID}': missing-owner`]
          }
        }
      })
    })

    it('rejects invalid persisted status error combinations', async () => {
      await expect(
        dbh.db.insert(knowledgeItemTable).values({
          baseId: KNOWLEDGE_BASE_ID,
          groupId: null,
          type: 'note',
          data: { source: 'invalid-note', content: 'invalid note' },
          status: 'completed',
          error: 'stale'
        })
      ).rejects.toThrow()

      await expect(
        dbh.db.insert(knowledgeItemTable).values({
          baseId: KNOWLEDGE_BASE_ID,
          groupId: null,
          type: 'note',
          data: { source: 'invalid-failed-note', content: 'invalid failed note' },
          status: 'failed',
          error: ''
        })
      ).rejects.toThrow()
    })

    it('rejects persisted progress statuses that do not match the item type', async () => {
      await expect(
        dbh.db.insert(knowledgeItemTable).values({
          baseId: KNOWLEDGE_BASE_ID,
          groupId: null,
          type: 'note',
          data: { source: 'invalid-note-phase', content: 'invalid note phase' },
          status: 'preparing',
          error: null
        })
      ).rejects.toThrow()

      await expect(
        dbh.db.insert(knowledgeItemTable).values({
          baseId: KNOWLEDGE_BASE_ID,
          groupId: null,
          type: 'directory',
          data: { source: '/docs' },
          status: 'reading',
          error: null
        })
      ).rejects.toThrow()
    })

    it('creates a file knowledge item with a copied relative path', async () => {
      const result = await service.create(KNOWLEDGE_BASE_ID, {
        type: 'file',
        data: {
          source: '/docs/a.md',
          relativePath: 'a.md'
        }
      })

      expect(result).toMatchObject({
        type: 'file',
        data: {
          source: '/docs/a.md',
          relativePath: 'a.md'
        }
      })
      const refs = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.sourceId, result.id))
      expect(refs).toHaveLength(0)
    })
  })

  describe('getById', () => {
    it('returns a knowledge item by id', async () => {
      const seeded = await seedItem({ data: { source: 'stored note', content: 'stored note' } })

      const result = await service.getById(seeded.id)

      expect(result).toMatchObject({
        id: seeded.id,
        data: { content: 'stored note' }
      })
    })

    it('throws NotFound when the knowledge item does not exist', async () => {
      await expect(service.getById('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('getSubtreeItems', () => {
    it('returns only leaf knowledge items in the requested subtrees when leafOnly is true', async () => {
      await seedItem({ id: DIR_ROOT_ID, type: 'directory', data: { source: '/root' } })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/root/child' }
      })
      await seedItem({
        id: FILE_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'file',
        data: createFileItemData(FILE_CHILD_ID)
      })
      await seedItem({
        id: NOTE_GRANDCHILD_ID,
        groupId: DIR_CHILD_ID,
        type: 'note',
        data: { source: 'grandchild', content: 'grandchild' }
      })
      await seedItem({ id: NOTE_ROOT_ID, type: 'note', data: { source: 'root note', content: 'root note' } })

      const result = await service.getSubtreeItems(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID, NOTE_ROOT_ID, 'missing'], {
        includeRoots: true,
        leafOnly: true
      })
      const itemsById = new Map(result.map((item) => [item.id, item]))

      expect(result.map((item) => item.id).sort()).toEqual([FILE_CHILD_ID, NOTE_GRANDCHILD_ID, NOTE_ROOT_ID])
      expect(itemsById.get(FILE_CHILD_ID)).toMatchObject({
        id: FILE_CHILD_ID,
        baseId: KNOWLEDGE_BASE_ID,
        groupId: DIR_ROOT_ID,
        type: 'file',
        data: createFileItemData(FILE_CHILD_ID)
      })
      expect(itemsById.get(NOTE_GRANDCHILD_ID)).toMatchObject({
        id: NOTE_GRANDCHILD_ID,
        baseId: KNOWLEDGE_BASE_ID,
        groupId: DIR_CHILD_ID,
        type: 'note',
        data: { content: 'grandchild' }
      })
      expect(itemsById.has(DIR_ROOT_ID)).toBe(false)
      expect(itemsById.has(DIR_CHILD_ID)).toBe(false)
    })

    it('returns every descendant in the requested subtrees without roots by default', async () => {
      await seedItem({ id: DIR_ROOT_ID, type: 'directory', data: { source: '/root' } })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/root/child' }
      })
      await seedItem({
        id: FILE_CHILD_ID,
        groupId: DIR_CHILD_ID,
        type: 'file',
        data: createFileItemData(FILE_CHILD_ID)
      })
      await seedItem({
        id: NOTE_ROOT_ID,
        type: 'note',
        data: { source: 'root note', content: 'root note' }
      })

      const result = await service.getSubtreeItems(KNOWLEDGE_BASE_ID, [
        DIR_ROOT_ID,
        DIR_CHILD_ID,
        NOTE_ROOT_ID,
        'missing'
      ])

      expect(result.map((item) => item.id).sort()).toEqual([FILE_CHILD_ID])
    })

    it('returns every descendant in the requested subtrees plus the roots themselves when includeRoots is true', async () => {
      await seedItem({ id: DIR_ROOT_ID, type: 'directory', data: { source: '/root' } })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/root/child' }
      })
      await seedItem({
        id: FILE_CHILD_ID,
        groupId: DIR_CHILD_ID,
        type: 'file',
        data: createFileItemData(FILE_CHILD_ID)
      })
      await seedItem({
        id: NOTE_ROOT_ID,
        type: 'note',
        data: { source: 'root note', content: 'root note' }
      })

      const result = await service.getSubtreeItems(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID, NOTE_ROOT_ID, 'missing'], {
        includeRoots: true
      })

      expect(result.map((item) => item.id).sort()).toEqual([DIR_CHILD_ID, DIR_ROOT_ID, FILE_CHILD_ID, NOTE_ROOT_ID])
    })

    it('deduplicates when an ancestor and its descendant are both passed as roots', async () => {
      await seedItem({ id: DIR_ROOT_ID, type: 'directory', data: { source: '/root' } })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/root/child' }
      })
      await seedItem({
        id: FILE_CHILD_ID,
        groupId: DIR_CHILD_ID,
        type: 'file',
        data: createFileItemData(FILE_CHILD_ID)
      })

      const result = await service.getSubtreeItems(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID, DIR_CHILD_ID], {
        includeRoots: true
      })

      expect(result.map((item) => item.id).sort()).toEqual([DIR_CHILD_ID, DIR_ROOT_ID, FILE_CHILD_ID])
    })

    it('reads subtree rows with a single raw query instead of a follow-up ORM select', async () => {
      await seedItem({ id: DIR_ROOT_ID, type: 'directory', data: { source: '/root' } })
      await seedItem({
        id: FILE_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'file',
        data: createFileItemData(FILE_CHILD_ID)
      })

      const allSpy = vi.spyOn(dbh.db, 'all')
      const selectSpy = vi.spyOn(dbh.db, 'select')

      try {
        const result = await service.getSubtreeItems(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID], { includeRoots: true })

        expect(result.map((item) => item.id).sort()).toEqual([DIR_ROOT_ID, FILE_CHILD_ID])
        expect(allSpy).toHaveBeenCalledTimes(1)
        expect(selectSpy).not.toHaveBeenCalled()
      } finally {
        allSpy.mockRestore()
        selectSpy.mockRestore()
      }
    })

    it('returns an empty list when no roots are provided', async () => {
      await expect(service.getSubtreeItems(KNOWLEDGE_BASE_ID, [])).resolves.toEqual([])
    })
  })

  describe('setSubtreeStatus', () => {
    async function getItemRow(id: string) {
      const [row] = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)
      return row
    }

    it('does not overwrite deleting items when marking a subtree failed', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: COMPLETED_CHILD_ID,
        groupId: DIR_ROOT_ID,
        data: { source: 'active', content: 'active' },
        status: 'processing'
      })
      await seedItem({
        id: DELETING_CHILD_ID,
        groupId: DIR_ROOT_ID,
        data: { source: 'deleting', content: 'deleting' },
        status: 'deleting'
      })

      await expect(
        service.setSubtreeStatus(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID], 'failed', { error: 'enqueue failed' })
      ).resolves.toEqual([DIR_ROOT_ID, COMPLETED_CHILD_ID])
      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'failed', error: 'enqueue failed' })
      await expect(getItemRow(COMPLETED_CHILD_ID)).resolves.toMatchObject({
        status: 'failed',
        error: 'enqueue failed'
      })
      await expect(getItemRow(DELETING_CHILD_ID)).resolves.toMatchObject({ status: 'deleting', error: null })
    })

    it('reconciles outer parent containers after failing a child subtree', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: NOTE_1_ID,
        groupId: DIR_ROOT_ID,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing'
      })

      await expect(
        service.setSubtreeStatus(KNOWLEDGE_BASE_ID, [NOTE_1_ID], 'failed', { error: 'enqueue failed' })
      ).resolves.toEqual([NOTE_1_ID])
      await expect(getItemRow(NOTE_1_ID)).resolves.toMatchObject({ status: 'failed', error: 'enqueue failed' })
      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({
        status: 'failed',
        error: 'One or more child items failed'
      })
    })
  })

  describe('updateStatus', () => {
    async function getItemRow(id: string) {
      const [row] = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)
      return row
    }

    it('updates progress status and clears stale error fields', async () => {
      const seeded = await seedItem()

      const result = await service.updateStatus(seeded.id, 'reading')

      expect(result).toMatchObject({
        id: seeded.id,
        status: 'reading',
        error: null
      })
      await expect(getItemRow(seeded.id)).resolves.toMatchObject({
        status: 'reading',
        error: null
      })
    })

    it('clears stale error when only status is supplied', async () => {
      const seeded = await seedItem({
        status: 'failed',
        error: 'previous failure'
      })

      const result = await service.updateStatus(seeded.id, 'processing')

      expect(result).toMatchObject({
        id: seeded.id,
        status: 'processing',
        error: null
      })
      await expect(getItemRow(seeded.id)).resolves.toMatchObject({
        status: 'processing',
        error: null
      })
    })

    it('reconciles parent containers after a child reaches a terminal state', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: NOTE_1_ID,
        groupId: DIR_ROOT_ID,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'reading'
      })

      await service.updateStatus(NOTE_1_ID, 'completed')

      await expect(getItemRow(NOTE_1_ID)).resolves.toMatchObject({
        status: 'completed',
        error: null
      })
      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({
        status: 'completed',
        error: null
      })
    })

    it('preserves explicit failed container status instead of reconciling it from children', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'preparing'
      })

      await service.updateStatus(DIR_ROOT_ID, 'failed', { error: 'enqueue failed' })

      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({
        status: 'failed',
        error: 'enqueue failed'
      })
    })

    it('throws NotFound when updating status for a missing item', async () => {
      await expect(service.updateStatus('missing', 'failed', { error: 'missing' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })

    it('normalizes failed status with a non-empty error', async () => {
      const seeded = await seedItem({
        status: 'reading',
        error: null
      })

      const result = await service.updateStatus(seeded.id, 'failed', { error: '  read failed  ' })

      expect(result).toMatchObject({
        status: 'failed',
        error: 'read failed'
      })
      await expect(getItemRow(seeded.id)).resolves.toMatchObject({
        status: 'failed',
        error: 'read failed'
      })
    })

    it('rejects failed status without a non-empty error', async () => {
      const seeded = await seedItem()

      await expect(service.updateStatus(seeded.id, 'failed', { error: '   ' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        status: 422
      })
    })

    it('does not overwrite deleting items with a non-delete status', async () => {
      const seeded = await seedItem({
        status: 'deleting'
      })

      const result = await service.updateStatus(seeded.id, 'completed')

      expect(result).toMatchObject({
        id: seeded.id,
        status: 'deleting',
        error: null
      })
      await expect(getItemRow(seeded.id)).resolves.toMatchObject({
        status: 'deleting',
        error: null
      })
    })

    it('does not overwrite deleting items with failed status from settled jobs', async () => {
      const seeded = await seedItem({
        status: 'deleting'
      })

      const result = await service.updateStatus(seeded.id, 'failed', { error: 'cancelled' })

      expect(result).toMatchObject({
        id: seeded.id,
        status: 'deleting',
        error: null
      })
      await expect(getItemRow(seeded.id)).resolves.toMatchObject({
        status: 'deleting',
        error: null
      })
    })
  })

  describe('delete', () => {
    it('deletes the requested item by id', async () => {
      const seeded = await seedItem()

      await expect(service.delete(seeded.id)).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, seeded.id))
      expect(rows).toHaveLength(0)
    })

    it('deletes file knowledge items by id', async () => {
      await seedItem({
        id: FILE_A_ID,
        type: 'file',
        data: createFileItemData(FILE_A_ID)
      })

      await service.delete(FILE_A_ID)

      const rows = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, FILE_A_ID))
      expect(rows).toHaveLength(0)
    })

    it('deletes the owner item and all group members through DB cascade', async () => {
      await seedItem({
        id: DIR_OWNER_ID,
        type: 'directory',
        data: { source: '/docs' }
      })
      await seedItem({
        id: CHILD_A_ID,
        groupId: DIR_OWNER_ID,
        type: 'note',
        data: { source: 'a', content: 'a' }
      })
      await seedItem({
        id: CHILD_B_ID,
        groupId: DIR_OWNER_ID,
        type: 'file',
        data: createFileItemData(CHILD_B_ID)
      })
      await seedItem({
        id: OTHER_ITEM_ID,
        type: 'note',
        data: { source: 'keep me', content: 'keep me' }
      })

      await service.delete(DIR_OWNER_ID)

      const remaining = await dbh.db.select().from(knowledgeItemTable).orderBy(knowledgeItemTable.id)
      expect(remaining.map((r) => r.id)).toEqual([OTHER_ITEM_ID])
    })

    it('deletes descendants while keeping the requested root items', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' }
      })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs/child' }
      })
      await seedItem({
        id: FILE_GRANDCHILD_ID,
        groupId: DIR_CHILD_ID,
        type: 'file',
        data: createFileItemData(FILE_GRANDCHILD_ID)
      })
      await seedItem({
        id: OTHER_ITEM_ID,
        type: 'note',
        data: { source: 'keep me', content: 'keep me' }
      })

      const descendants = await service.getSubtreeItems(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID])
      await service.deleteItemsByIds(
        KNOWLEDGE_BASE_ID,
        descendants.map((item) => item.id)
      )

      const remaining = await dbh.db.select().from(knowledgeItemTable).orderBy(knowledgeItemTable.id)
      expect(remaining.map((r) => r.id)).toEqual([DIR_ROOT_ID, OTHER_ITEM_ID])
    })

    it('deletes descendants when deleting a directory by id', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' }
      })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs/child' }
      })
      await seedItem({
        id: FILE_GRANDCHILD_ID,
        groupId: DIR_CHILD_ID,
        type: 'file',
        data: createFileItemData(FILE_GRANDCHILD_ID)
      })
      await seedItem({
        id: OTHER_ITEM_ID,
        type: 'note',
        data: { source: 'keep me', content: 'keep me' }
      })

      await service.deleteItemsByIds(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID])

      const remaining = await dbh.db.select().from(knowledgeItemTable).orderBy(knowledgeItemTable.id)
      expect(remaining.map((r) => r.id)).toEqual([OTHER_ITEM_ID])
    })

    it('throws NotFound when deleting a missing knowledge item', async () => {
      await expect(service.delete('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('updateIndexedRelativePath', () => {
    it('stores the processed markdown path on file item data', async () => {
      await seedItem({
        id: FILE_A_ID,
        type: 'file',
        data: createFileItemData(FILE_A_ID)
      })

      const result = await service.updateIndexedRelativePath(FILE_A_ID, 'processed.md')

      expect(result).toMatchObject({
        id: FILE_A_ID,
        type: 'file',
        data: {
          source: `/docs/${FILE_A_ID.slice(0, 8)}.md`,
          relativePath: `${FILE_A_ID.slice(0, 8)}.md`,
          indexedRelativePath: 'processed.md'
        }
      })
    })

    it('rejects updating indexed path for a missing knowledge item', async () => {
      await expect(service.updateIndexedRelativePath(OTHER_ITEM_ID, 'processed.md')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('rejects updating indexed path for a non-file item', async () => {
      await seedItem({
        id: NOTE_A_ID,
        type: 'note',
        data: { source: 'note', content: 'note' }
      })

      await expect(service.updateIndexedRelativePath(NOTE_A_ID, 'processed.md')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })
  })

  describe('updateSnapshotRelativePath', () => {
    it('stores the captured snapshot path on url item data, preserving source/url', async () => {
      await seedItem({
        id: ITEM_1_ID,
        type: 'url',
        data: { source: 'https://example.com', url: 'https://example.com' }
      })

      const result = await service.updateSnapshotRelativePath(ITEM_1_ID, 'url', 'example.md')

      expect(result).toMatchObject({
        id: ITEM_1_ID,
        type: 'url',
        data: {
          source: 'https://example.com',
          url: 'https://example.com',
          relativePath: 'example.md'
        }
      })
    })

    it('stores the captured snapshot path on note item data, preserving source/content', async () => {
      await seedItem({
        id: NOTE_A_ID,
        type: 'note',
        data: { source: 'Meeting notes', content: '# Meeting\n\nbody' }
      })

      const result = await service.updateSnapshotRelativePath(NOTE_A_ID, 'note', 'Meeting notes.md')

      expect(result).toMatchObject({
        id: NOTE_A_ID,
        type: 'note',
        data: {
          source: 'Meeting notes',
          content: '# Meeting\n\nbody',
          relativePath: 'Meeting notes.md'
        }
      })
    })

    it('rejects updating snapshot path for a missing knowledge item', async () => {
      await expect(service.updateSnapshotRelativePath(OTHER_ITEM_ID, 'url', 'example.md')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('rejects storing a url snapshot path on a note item', async () => {
      await seedItem({
        id: NOTE_A_ID,
        type: 'note',
        data: { source: 'note', content: 'note' }
      })

      await expect(service.updateSnapshotRelativePath(NOTE_A_ID, 'url', 'example.md')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('rejects storing a note snapshot path on a url item', async () => {
      await seedItem({
        id: ITEM_1_ID,
        type: 'url',
        data: { source: 'https://example.com', url: 'https://example.com' }
      })

      await expect(service.updateSnapshotRelativePath(ITEM_1_ID, 'note', 'note.md')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })
  })

  describe('updateDirectoryRelativePath', () => {
    it('stores the deduped raw/ prefix on directory item data, preserving source', async () => {
      await seedItem({
        id: DIR_A_ID,
        type: 'directory',
        data: { source: '/docs' }
      })

      const result = await service.updateDirectoryRelativePath(DIR_A_ID, 'docs')

      expect(result).toMatchObject({
        id: DIR_A_ID,
        type: 'directory',
        data: {
          source: '/docs',
          relativePath: 'docs'
        }
      })
    })

    it('rejects updating directory relative path for a missing knowledge item', async () => {
      await expect(service.updateDirectoryRelativePath(OTHER_ITEM_ID, 'docs')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('rejects storing a directory relative path on a non-directory item', async () => {
      await seedItem({
        id: NOTE_A_ID,
        type: 'note',
        data: { source: 'note', content: 'note' }
      })

      await expect(service.updateDirectoryRelativePath(NOTE_A_ID, 'docs')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })
  })

  describe('container reconciliation', () => {
    async function getItemRow(id: string) {
      const [row] = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)
      return row
    }

    it('marks a parent container completed when its last child completes', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: NOTE_1_ID,
        groupId: DIR_ROOT_ID,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing'
      })

      await service.updateStatus(NOTE_1_ID, 'completed')

      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({
        id: DIR_ROOT_ID,
        status: 'completed',
        error: null
      })
    })

    it('marks nested containers completed after leaf descendants are deleted', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs/child' },
        status: 'processing'
      })
      await seedItem({
        id: NOTE_1_ID,
        groupId: DIR_CHILD_ID,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing'
      })
      await service.delete(NOTE_1_ID)

      await expect(getItemRow(DIR_CHILD_ID)).resolves.toMatchObject({ status: 'completed', error: null })
      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'completed', error: null })
    })

    it('leaves a container processing while any immediate child is active', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: NOTE_1_ID,
        groupId: DIR_ROOT_ID,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing'
      })

      await service.updateStatus(NOTE_1_ID, 'processing')

      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'processing', error: null })
    })

    it('marks a container failed when all immediate children are terminal and one failed', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: NOTE_1_ID,
        groupId: DIR_ROOT_ID,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'failed',
        error: 'read failed'
      })

      await service.updateStatus(NOTE_1_ID, 'failed', { error: 'read failed' })

      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({
        status: 'failed',
        error: 'One or more child items failed'
      })
    })

    it('keeps a preparing container unchanged while reconciling its parent', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs/child' },
        status: 'preparing'
      })
      await seedItem({
        id: NOTE_1_ID,
        groupId: DIR_CHILD_ID,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing'
      })

      await service.updateStatus(NOTE_1_ID, 'completed')

      await expect(getItemRow(DIR_CHILD_ID)).resolves.toMatchObject({ status: 'preparing', error: null })
      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'processing', error: null })
    })

    it('leaves a deleting container untouched', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'deleting'
      })
      await seedItem({
        id: NOTE_1_ID,
        groupId: DIR_ROOT_ID,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing'
      })

      await service.updateStatus(NOTE_1_ID, 'completed')

      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'deleting', error: null })
    })

    it('does not count deleting children as active', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: COMPLETED_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'note',
        data: { source: 'completed', content: 'completed' },
        status: 'completed'
      })
      await seedItem({
        id: DELETING_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'note',
        data: { source: 'deleting', content: 'deleting' },
        status: 'deleting'
      })

      await service.updateStatus(COMPLETED_CHILD_ID, 'completed')

      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'completed', error: null })
    })

    it('reconciles surviving parent containers after hard deleting their last active child', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: NOTE_1_ID,
        groupId: DIR_ROOT_ID,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing'
      })

      await service.deleteItemsByIds(KNOWLEDGE_BASE_ID, [NOTE_1_ID])

      await expect(getItemRow(NOTE_1_ID)).resolves.toBeUndefined()
      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'completed', error: null })
    })

    it('reconciles containers bottom-up after active leaves are deleted', async () => {
      await seedItem({
        id: DIR_A_ID,
        type: 'directory',
        data: { source: '/docs/a' },
        status: 'processing'
      })
      await seedItem({
        id: FILE_A_ID,
        groupId: DIR_A_ID,
        type: 'file',
        data: createFileItemData(FILE_A_ID),
        status: 'processing'
      })
      await seedItem({
        id: DIR_B_ID,
        groupId: DIR_A_ID,
        type: 'directory',
        data: { source: '/docs/a/b' },
        status: 'processing'
      })
      await seedItem({
        id: FILE_B_ID,
        groupId: DIR_B_ID,
        type: 'file',
        data: createFileItemData(FILE_B_ID),
        status: 'processing'
      })

      await service.delete(FILE_B_ID)

      await expect(getItemRow(DIR_B_ID)).resolves.toMatchObject({ status: 'completed', error: null })
      await expect(getItemRow(DIR_A_ID)).resolves.toMatchObject({ status: 'processing', error: null })

      await service.delete(FILE_A_ID)

      await expect(getItemRow(DIR_A_ID)).resolves.toMatchObject({ status: 'completed', error: null })
    })
  })
})
