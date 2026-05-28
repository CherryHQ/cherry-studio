import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { KnowledgeItemService } from '@data/services/KnowledgeItemService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api'
import type { FileEntryId } from '@shared/data/types/file'
import type { CreateKnowledgeItemDto } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

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
const SITEMAP_A_ID = itemId('7d25')
const NOTE_OWNER_ID = itemId('7d26')
const DIR_CHILD_ID = itemId('7d30')
const DIR_ROOT_ID = itemId('7d31')
const FILE_CHILD_ID = itemId('7d40')
const NOTE_GRANDCHILD_ID = itemId('7d41')
const NOTE_ROOT_ID = itemId('7d42')
const URL_CHILD_ID = itemId('7d43')
const SITEMAP_ROOT_ID = itemId('7d44')
const DIR_OWNER_ID = itemId('7d45')
const CHILD_A_ID = itemId('7d46')
const CHILD_B_ID = itemId('7d47')
const OTHER_ITEM_ID = itemId('7d50')
const FILE_GRANDCHILD_ID = itemId('7d51')
const COMPLETED_CHILD_ID = itemId('7d52')
const DELETING_CHILD_ID = itemId('7d53')
const FILE_A_ID = itemId('7d60')
const FILE_B_ID = itemId('7d61')
const FILE_ENTRY_A_ID = '019606a0-0000-7000-8000-000000000a01' as FileEntryId

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
      emoji: '📁',
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
      fileEntryId: id
    }
  }

  async function seedFileEntry(id: FileEntryId = FILE_ENTRY_A_ID) {
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: `file-${id.slice(-4)}`,
      ext: 'md',
      size: 1,
      externalPath: null
    })
  }

  async function seedKnowledgeFileRef(sourceId: string, fileEntryId: FileEntryId = FILE_ENTRY_A_ID) {
    const [, sourceSequence] = sourceId.split('-')
    await dbh.db.insert(fileRefTable).values({
      id: `11111111-1111-4111-8111-${sourceSequence}${sourceId.slice(-8)}`,
      fileEntryId,
      sourceType: 'knowledge_item',
      sourceId,
      role: 'source'
    })
  }

  describe('list', () => {
    it('returns paginated items for a knowledge base', async () => {
      await seedItem()

      const result = await service.list(KNOWLEDGE_BASE_ID, { page: 1, limit: 20 })

      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.items[0]).toMatchObject({
        baseId: KNOWLEDGE_BASE_ID,
        type: 'note',
        data: { content: 'hello world' }
      })
    })

    it('filters items by type and group', async () => {
      await seedItem({ id: DIR_A_ID, type: 'directory', data: { source: '/a', path: '/a' } })
      await seedItem({ id: DIR_B_ID, type: 'directory', data: { source: '/b', path: '/b' } })
      await seedItem({ id: NOTE_1_ID, type: 'note', groupId: DIR_A_ID, data: { source: NOTE_1_ID, content: 'n1' } })

      const directories = await service.list(KNOWLEDGE_BASE_ID, { page: 1, limit: 20, type: 'directory' })
      const grouped = await service.list(KNOWLEDGE_BASE_ID, { page: 1, limit: 20, groupId: DIR_A_ID })

      expect(directories.items.map((item) => item.id).sort()).toEqual([DIR_A_ID, DIR_B_ID])
      expect(grouped.items.map((item) => item.id)).toEqual([NOTE_1_ID])
    })

    it('filters root items when groupId is null', async () => {
      await seedItem({ id: DIR_A_ID, type: 'directory', data: { source: '/a', path: '/a' } })
      await seedItem({ id: NOTE_ROOT_ID, type: 'note', data: { source: 'root', content: 'root' } })
      await seedItem({ id: NOTE_1_ID, type: 'note', groupId: DIR_A_ID, data: { source: 'child', content: 'child' } })

      const result = await service.list(KNOWLEDGE_BASE_ID, { page: 1, limit: 20, groupId: null })

      expect(result.total).toBe(2)
      expect(result.items.map((item) => item.id).sort()).toEqual([DIR_A_ID, NOTE_ROOT_ID])
    })

    it('hides deleting items', async () => {
      await seedItem({ id: VISIBLE_NOTE_ID, data: { source: 'visible', content: 'visible' } })
      await seedItem({ id: DELETING_NOTE_ID, data: { source: 'deleting', content: 'deleting' }, status: 'deleting' })

      const result = await service.list(KNOWLEDGE_BASE_ID, { page: 1, limit: 20 })

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

    it('filters items by group id', async () => {
      await seedItem({ id: DIR_A_ID, type: 'directory', data: { source: '/a', path: '/a' } })
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

  describe('create', () => {
    it('creates one knowledge item as idle', async () => {
      const item: CreateKnowledgeItemDto = {
        type: 'directory',
        data: { source: '/tmp/files', path: '/tmp/files' }
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
      await seedItem({ id: DIR_A_ID, type: 'directory', data: { source: '/a', path: '/a' } })

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

    it('accepts sitemap group owners', async () => {
      await seedItem({
        id: SITEMAP_A_ID,
        type: 'sitemap',
        data: { source: 'https://example.com/sitemap.xml', url: 'https://example.com/sitemap.xml' }
      })

      const result = await service.create(KNOWLEDGE_BASE_ID, {
        groupId: SITEMAP_A_ID,
        type: 'url',
        data: { source: 'https://example.com/page', url: 'https://example.com/page' }
      })

      expect(result).toMatchObject({
        baseId: KNOWLEDGE_BASE_ID,
        groupId: SITEMAP_A_ID,
        type: 'url'
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
            groupId: [`Knowledge item group owner must be a directory or sitemap: ${NOTE_OWNER_ID}`]
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
          data: { source: '/docs', path: '/docs' },
          status: 'reading',
          error: null
        })
      ).rejects.toThrow()
    })

    it('creates a source file_ref with the file knowledge item', async () => {
      await seedFileEntry(FILE_ENTRY_A_ID)

      const result = await service.create(KNOWLEDGE_BASE_ID, {
        type: 'file',
        data: {
          source: '/docs/a.md',
          fileEntryId: FILE_ENTRY_A_ID
        }
      })

      const refs = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.sourceId, result.id))
      expect(refs).toHaveLength(1)
      expect(refs[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      expect(refs[0]).toMatchObject({
        fileEntryId: FILE_ENTRY_A_ID,
        sourceType: 'knowledge_item',
        sourceId: result.id,
        role: 'source'
      })
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

  describe('getLeafDescendantItems', () => {
    it('returns only leaf knowledge items in the requested subtrees', async () => {
      await seedItem({ id: DIR_ROOT_ID, type: 'directory', data: { source: '/root', path: '/root' } })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/root/child', path: '/root/child' }
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
      await seedItem({
        id: SITEMAP_ROOT_ID,
        type: 'sitemap',
        data: { source: 'https://example.com', url: 'https://example.com' }
      })
      await seedItem({
        id: URL_CHILD_ID,
        groupId: SITEMAP_ROOT_ID,
        type: 'url',
        data: { source: 'https://example.com/page', url: 'https://example.com/page' }
      })
      await seedItem({ id: NOTE_ROOT_ID, type: 'note', data: { source: 'root note', content: 'root note' } })

      const result = await service.getLeafDescendantItems(KNOWLEDGE_BASE_ID, [
        DIR_ROOT_ID,
        SITEMAP_ROOT_ID,
        NOTE_ROOT_ID,
        'missing'
      ])
      const itemsById = new Map(result.map((item) => [item.id, item]))

      expect(result.map((item) => item.id).sort()).toEqual([
        FILE_CHILD_ID,
        NOTE_GRANDCHILD_ID,
        NOTE_ROOT_ID,
        URL_CHILD_ID
      ])
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
      expect(itemsById.get(URL_CHILD_ID)).toMatchObject({
        id: URL_CHILD_ID,
        baseId: KNOWLEDGE_BASE_ID,
        groupId: SITEMAP_ROOT_ID,
        type: 'url',
        data: { url: 'https://example.com/page' }
      })
      expect(itemsById.has(DIR_ROOT_ID)).toBe(false)
      expect(itemsById.has(DIR_CHILD_ID)).toBe(false)
      expect(itemsById.has(SITEMAP_ROOT_ID)).toBe(false)
    })

    it('returns an empty list when no roots are provided', async () => {
      await expect(service.getLeafDescendantItems(KNOWLEDGE_BASE_ID, [])).resolves.toEqual([])
    })
  })

  describe('getDescendantItems', () => {
    it('returns every descendant in the requested subtrees without roots', async () => {
      await seedItem({ id: DIR_ROOT_ID, type: 'directory', data: { source: '/root', path: '/root' } })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/root/child', path: '/root/child' }
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

      const result = await service.getDescendantItems(KNOWLEDGE_BASE_ID, [
        DIR_ROOT_ID,
        DIR_CHILD_ID,
        NOTE_ROOT_ID,
        'missing'
      ])

      expect(result.map((item) => item.id).sort()).toEqual([FILE_CHILD_ID])
    })

    it('returns an empty list when no roots are provided', async () => {
      await expect(service.getDescendantItems(KNOWLEDGE_BASE_ID, [])).resolves.toEqual([])
    })
  })

  describe('getDescendantAndSelfItems', () => {
    it('returns every descendant in the requested subtrees plus the roots themselves', async () => {
      await seedItem({ id: DIR_ROOT_ID, type: 'directory', data: { source: '/root', path: '/root' } })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/root/child', path: '/root/child' }
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

      const result = await service.getDescendantAndSelfItems(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID, NOTE_ROOT_ID, 'missing'])

      expect(result.map((item) => item.id).sort()).toEqual([DIR_CHILD_ID, DIR_ROOT_ID, FILE_CHILD_ID, NOTE_ROOT_ID])
    })

    it('deduplicates when an ancestor and its descendant are both passed as roots', async () => {
      await seedItem({ id: DIR_ROOT_ID, type: 'directory', data: { source: '/root', path: '/root' } })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/root/child', path: '/root/child' }
      })
      await seedItem({
        id: FILE_CHILD_ID,
        groupId: DIR_CHILD_ID,
        type: 'file',
        data: createFileItemData(FILE_CHILD_ID)
      })

      const result = await service.getDescendantAndSelfItems(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID, DIR_CHILD_ID])

      expect(result.map((item) => item.id).sort()).toEqual([DIR_CHILD_ID, DIR_ROOT_ID, FILE_CHILD_ID])
    })

    it('returns an empty list when no roots are provided', async () => {
      await expect(service.getDescendantAndSelfItems(KNOWLEDGE_BASE_ID, [])).resolves.toEqual([])
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
        data: { source: '/docs', path: '/docs' },
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
  })

  describe('delete', () => {
    it('deletes the requested item by id', async () => {
      const seeded = await seedItem()

      await expect(service.delete(seeded.id)).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, seeded.id))
      expect(rows).toHaveLength(0)
    })

    it('deletes knowledge item file_refs in the same delete flow', async () => {
      await seedFileEntry(FILE_ENTRY_A_ID)
      await seedItem({
        id: FILE_A_ID,
        type: 'file',
        data: createFileItemData(FILE_ENTRY_A_ID)
      })
      await seedKnowledgeFileRef(FILE_A_ID, FILE_ENTRY_A_ID)

      await service.delete(FILE_A_ID)

      const refs = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.sourceId, FILE_A_ID))
      expect(refs).toHaveLength(0)
    })

    it('deletes the owner item and all group members through DB cascade', async () => {
      await seedItem({
        id: DIR_OWNER_ID,
        type: 'directory',
        data: { source: '/docs', path: '/docs' }
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
        type: 'url',
        data: { source: 'https://example.com', url: 'https://example.com' }
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
      await seedFileEntry(FILE_ENTRY_A_ID)
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs', path: '/docs' }
      })
      await seedItem({
        id: FILE_A_ID,
        type: 'file',
        data: createFileItemData(FILE_ENTRY_A_ID)
      })
      await seedKnowledgeFileRef(FILE_A_ID, FILE_ENTRY_A_ID)
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs/child', path: '/docs/child' }
      })
      await seedItem({
        id: FILE_GRANDCHILD_ID,
        groupId: DIR_CHILD_ID,
        type: 'file',
        data: createFileItemData(FILE_ENTRY_A_ID)
      })
      await seedKnowledgeFileRef(FILE_GRANDCHILD_ID, FILE_ENTRY_A_ID)
      await seedItem({
        id: OTHER_ITEM_ID,
        type: 'note',
        data: { source: 'keep me', content: 'keep me' }
      })
      await seedItem({
        id: FILE_B_ID,
        type: 'file',
        data: createFileItemData(FILE_ENTRY_A_ID)
      })
      await seedKnowledgeFileRef(FILE_B_ID, FILE_ENTRY_A_ID)

      await service.deleteLeafDescendantItems(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID, FILE_A_ID])

      const remaining = await dbh.db.select().from(knowledgeItemTable).orderBy(knowledgeItemTable.id)
      expect(remaining.map((r) => r.id)).toEqual([DIR_ROOT_ID, OTHER_ITEM_ID, FILE_A_ID, FILE_B_ID])
      const deletedDescendantRefs = await dbh.db
        .select()
        .from(fileRefTable)
        .where(eq(fileRefTable.sourceId, FILE_GRANDCHILD_ID))
      const keptRootRefs = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.sourceId, FILE_A_ID))
      const keptSiblingRefs = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.sourceId, FILE_B_ID))
      expect(deletedDescendantRefs).toHaveLength(0)
      expect(keptRootRefs).toHaveLength(1)
      expect(keptSiblingRefs).toHaveLength(1)
    })

    it('throws NotFound when deleting a missing knowledge item', async () => {
      await expect(service.delete('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('reconcileContainers', () => {
    async function getItemRow(id: string) {
      const [row] = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)
      return row
    }

    it('marks a processing container completed when it has no remaining children', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs', path: '/docs' },
        status: 'processing'
      })

      await service.reconcileContainers(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID])

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
        data: { source: '/docs', path: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs/child', path: '/docs/child' },
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

      await service.reconcileContainers(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID])

      await expect(getItemRow(DIR_CHILD_ID)).resolves.toMatchObject({ status: 'completed', error: null })
      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'completed', error: null })
    })

    it('leaves a container processing while any immediate child is active', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs', path: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: NOTE_1_ID,
        groupId: DIR_ROOT_ID,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing'
      })

      await service.reconcileContainers(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID])

      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'processing', error: null })
    })

    it('marks a container failed when all immediate children are terminal and one failed', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs', path: '/docs' },
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

      await service.reconcileContainers(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID])

      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({
        status: 'failed',
        error: 'One or more child items failed'
      })
    })

    it('keeps a preparing container unchanged while reconciling its parent', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs', path: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: DIR_CHILD_ID,
        groupId: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs/child', path: '/docs/child' },
        status: 'preparing'
      })
      await seedItem({
        id: NOTE_1_ID,
        groupId: DIR_CHILD_ID,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing'
      })

      await service.reconcileContainers(KNOWLEDGE_BASE_ID, [DIR_CHILD_ID])

      await expect(getItemRow(DIR_CHILD_ID)).resolves.toMatchObject({ status: 'preparing', error: null })
      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'processing', error: null })
    })

    it('leaves a deleting container untouched', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs', path: '/docs' },
        status: 'deleting'
      })

      await service.reconcileContainers(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID])

      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'deleting', error: null })
    })

    it('does not count deleting children as active', async () => {
      await seedItem({
        id: DIR_ROOT_ID,
        type: 'directory',
        data: { source: '/docs', path: '/docs' },
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

      await service.reconcileContainers(KNOWLEDGE_BASE_ID, [DIR_ROOT_ID])

      await expect(getItemRow(DIR_ROOT_ID)).resolves.toMatchObject({ status: 'completed', error: null })
    })

    it('does nothing when the root no longer exists', async () => {
      await expect(service.reconcileContainers(KNOWLEDGE_BASE_ID, ['missing-root'])).resolves.toBeUndefined()
    })

    it('reconciles containers bottom-up after active leaves are deleted', async () => {
      await seedItem({
        id: DIR_A_ID,
        type: 'directory',
        data: { source: '/docs/a', path: '/docs/a' },
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
        data: { source: '/docs/a/b', path: '/docs/a/b' },
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
