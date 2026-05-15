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
import { beforeEach, describe, expect, it } from 'vitest'

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
      id: 'kb-1',
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
      baseId: 'kb-1',
      groupId: null,
      type: 'note',
      data: { source: 'seed-note', content: 'hello world' },
      status: 'idle',
      phase: null,
      error: null,
      ...overrides
    }
    const [inserted] = await dbh.db.insert(knowledgeItemTable).values(values).returning()
    return inserted
  }

  function createFileItemData(id: string) {
    return {
      source: `/docs/${id}.md`,
      file: {
        id: `${id}-meta`,
        name: `${id}.md`,
        origin_name: `${id}.md`,
        path: `/docs/${id}.md`,
        created_at: '2026-04-08T00:00:00.000Z',
        size: 10,
        ext: '.md',
        type: 'text' as const,
        count: 1
      }
    }
  }

  describe('list', () => {
    it('returns paginated items for a knowledge base', async () => {
      await seedItem()

      const result = await service.list('kb-1', { page: 1, limit: 20 })

      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.items[0]).toMatchObject({
        baseId: 'kb-1',
        type: 'note',
        data: { content: 'hello world' }
      })
    })

    it('filters items by type and group', async () => {
      await seedItem({ id: 'dir-a', type: 'directory', data: { source: '/a', path: '/a' } })
      await seedItem({ id: 'dir-b', type: 'directory', data: { source: '/b', path: '/b' } })
      await seedItem({ id: 'note-1', type: 'note', groupId: 'dir-a', data: { source: 'note-1', content: 'n1' } })

      const directories = await service.list('kb-1', { page: 1, limit: 20, type: 'directory' })
      const grouped = await service.list('kb-1', { page: 1, limit: 20, groupId: 'dir-a' })

      expect(directories.items.map((item) => item.id).sort()).toEqual(['dir-a', 'dir-b'])
      expect(grouped.items.map((item) => item.id)).toEqual(['note-1'])
    })

    it('filters root items when groupId is null', async () => {
      await seedItem({ id: 'dir-a', type: 'directory', data: { source: '/a', path: '/a' } })
      await seedItem({ id: 'note-root', type: 'note', data: { source: 'root', content: 'root' } })
      await seedItem({ id: 'note-child', type: 'note', groupId: 'dir-a', data: { source: 'child', content: 'child' } })

      const result = await service.list('kb-1', { page: 1, limit: 20, groupId: null })

      expect(result.total).toBe(2)
      expect(result.items.map((item) => item.id).sort()).toEqual(['dir-a', 'note-root'])
    })
  })

  describe('getItemsByBaseId', () => {
    it('returns items in creation order for a knowledge base', async () => {
      await seedItem({
        id: 'item-2',
        data: { source: 'item-2', content: 'item 2' },
        createdAt: 20,
        updatedAt: 20
      })
      await seedItem({
        id: 'item-1',
        data: { source: 'item-1', content: 'item 1' },
        createdAt: 10,
        updatedAt: 10
      })

      const result = await service.getItemsByBaseId('kb-1')

      expect(result.map((item) => item.id)).toEqual(['item-1', 'item-2'])
      expect(result[0]).toMatchObject({
        id: 'item-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: { source: 'item-1', content: 'item 1' },
        status: 'idle',
        phase: null,
        error: null
      })
    })

    it('filters root items when groupId is null', async () => {
      await seedItem({
        id: 'root-2',
        data: { source: 'root-2', content: 'root 2' },
        createdAt: 20,
        updatedAt: 20
      })
      await seedItem({
        id: 'root-1',
        data: { source: 'root-1', content: 'root 1' },
        createdAt: 10,
        updatedAt: 10
      })
      await seedItem({
        id: 'child-1',
        groupId: 'root-1',
        data: { source: 'child-1', content: 'child 1' },
        createdAt: 15,
        updatedAt: 15
      })

      const result = await service.getItemsByBaseId('kb-1', { groupId: null })

      expect(result.map((item) => item.id)).toEqual(['root-1', 'root-2'])
    })

    it('filters items by group id', async () => {
      await seedItem({ id: 'dir-a', type: 'directory', data: { source: '/a', path: '/a' } })
      await seedItem({ id: 'note-a', groupId: 'dir-a', data: { source: 'a', content: 'a' } })
      await seedItem({ id: 'note-root', data: { source: 'root', content: 'root' } })

      const result = await service.getItemsByBaseId('kb-1', { groupId: 'dir-a' })

      expect(result.map((item) => item.id)).toEqual(['note-a'])
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

      const result = await service.create('kb-1', item)

      expect(result).toMatchObject({
        baseId: 'kb-1',
        groupId: null,
        type: 'directory',
        status: 'idle',
        phase: null,
        error: null,
        data: item.data
      })
    })

    it('accepts a group owner in the same base', async () => {
      await seedItem({ id: 'dir-a', type: 'directory', data: { source: '/a', path: '/a' } })

      const result = await service.create('kb-1', {
        groupId: 'dir-a',
        type: 'note',
        data: { source: 'new grouped note', content: 'new grouped note' }
      })

      expect(result).toMatchObject({
        baseId: 'kb-1',
        groupId: 'dir-a',
        type: 'note'
      })
    })

    it('accepts sitemap group owners', async () => {
      await seedItem({
        id: 'sitemap-a',
        type: 'sitemap',
        data: { source: 'https://example.com/sitemap.xml', url: 'https://example.com/sitemap.xml' }
      })

      const result = await service.create('kb-1', {
        groupId: 'sitemap-a',
        type: 'url',
        data: { source: 'https://example.com/page', url: 'https://example.com/page' }
      })

      expect(result).toMatchObject({
        baseId: 'kb-1',
        groupId: 'sitemap-a',
        type: 'url'
      })
    })

    it('rejects leaf items as group owners', async () => {
      await seedItem({ id: 'note-owner', type: 'note', data: { source: 'owner', content: 'owner' } })

      await expect(
        service.create('kb-1', {
          groupId: 'note-owner',
          type: 'note',
          data: { source: 'child note', content: 'child note' }
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            groupId: ['Knowledge item group owner must be a directory or sitemap: note-owner']
          }
        }
      })
    })

    it('rejects blank group owner ids before hitting foreign key constraints', async () => {
      await expect(
        service.create('kb-1', {
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
        service.create('kb-1', {
          groupId: 'missing-owner',
          type: 'note',
          data: { source: 'child note', content: 'child note' }
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            groupId: ["Knowledge item group owner not found in base 'kb-1': missing-owner"]
          }
        }
      })
    })

    it('rejects invalid persisted status phase error combinations', async () => {
      await expect(
        dbh.db.insert(knowledgeItemTable).values({
          baseId: 'kb-1',
          groupId: null,
          type: 'note',
          data: { source: 'invalid-note', content: 'invalid note' },
          status: 'completed',
          phase: 'reading',
          error: null
        })
      ).rejects.toThrow()

      await expect(
        dbh.db.insert(knowledgeItemTable).values({
          baseId: 'kb-1',
          groupId: null,
          type: 'note',
          data: { source: 'invalid-failed-note', content: 'invalid failed note' },
          status: 'failed',
          phase: null,
          error: ''
        })
      ).rejects.toThrow()
    })

    it('rejects persisted processing phases that do not match the item type', async () => {
      await expect(
        dbh.db.insert(knowledgeItemTable).values({
          baseId: 'kb-1',
          groupId: null,
          type: 'note',
          data: { source: 'invalid-note-phase', content: 'invalid note phase' },
          status: 'processing',
          phase: 'preparing',
          error: null
        })
      ).rejects.toThrow()

      await expect(
        dbh.db.insert(knowledgeItemTable).values({
          baseId: 'kb-1',
          groupId: null,
          type: 'directory',
          data: { source: '/docs', path: '/docs' },
          status: 'processing',
          phase: 'reading',
          error: null
        })
      ).rejects.toThrow()
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
      await seedItem({ id: 'dir-root', type: 'directory', data: { source: '/root', path: '/root' } })
      await seedItem({
        id: 'dir-child',
        groupId: 'dir-root',
        type: 'directory',
        data: { source: '/root/child', path: '/root/child' }
      })
      await seedItem({
        id: 'file-child',
        groupId: 'dir-root',
        type: 'file',
        data: createFileItemData('file-child')
      })
      await seedItem({
        id: 'note-grandchild',
        groupId: 'dir-child',
        type: 'note',
        data: { source: 'grandchild', content: 'grandchild' }
      })
      await seedItem({
        id: 'sitemap-root',
        type: 'sitemap',
        data: { source: 'https://example.com', url: 'https://example.com' }
      })
      await seedItem({
        id: 'url-child',
        groupId: 'sitemap-root',
        type: 'url',
        data: { source: 'https://example.com/page', url: 'https://example.com/page' }
      })
      await seedItem({ id: 'note-root', type: 'note', data: { source: 'root note', content: 'root note' } })

      const result = await service.getLeafDescendantItems('kb-1', ['dir-root', 'sitemap-root', 'note-root', 'missing'])
      const itemsById = new Map(result.map((item) => [item.id, item]))

      expect(result.map((item) => item.id).sort()).toEqual(['file-child', 'note-grandchild', 'note-root', 'url-child'])
      expect(itemsById.get('file-child')).toMatchObject({
        id: 'file-child',
        baseId: 'kb-1',
        groupId: 'dir-root',
        type: 'file',
        data: createFileItemData('file-child')
      })
      expect(itemsById.get('note-grandchild')).toMatchObject({
        id: 'note-grandchild',
        baseId: 'kb-1',
        groupId: 'dir-child',
        type: 'note',
        data: { content: 'grandchild' }
      })
      expect(itemsById.get('url-child')).toMatchObject({
        id: 'url-child',
        baseId: 'kb-1',
        groupId: 'sitemap-root',
        type: 'url',
        data: { url: 'https://example.com/page' }
      })
      expect(itemsById.has('dir-root')).toBe(false)
      expect(itemsById.has('dir-child')).toBe(false)
      expect(itemsById.has('sitemap-root')).toBe(false)
    })

    it('returns an empty list when no roots are provided', async () => {
      await expect(service.getLeafDescendantItems('kb-1', [])).resolves.toEqual([])
    })
  })

  describe('getDescendantItems', () => {
    it('returns every descendant in the requested subtrees without roots', async () => {
      await seedItem({ id: 'dir-root', type: 'directory', data: { source: '/root', path: '/root' } })
      await seedItem({
        id: 'dir-child',
        groupId: 'dir-root',
        type: 'directory',
        data: { source: '/root/child', path: '/root/child' }
      })
      await seedItem({
        id: 'file-child',
        groupId: 'dir-child',
        type: 'file',
        data: createFileItemData('file-child')
      })
      await seedItem({
        id: 'note-root',
        type: 'note',
        data: { source: 'root note', content: 'root note' }
      })

      const result = await service.getDescendantItems('kb-1', ['dir-root', 'dir-child', 'note-root', 'missing'])

      expect(result.map((item) => item.id).sort()).toEqual(['file-child'])
    })

    it('returns an empty list when no roots are provided', async () => {
      await expect(service.getDescendantItems('kb-1', [])).resolves.toEqual([])
    })
  })

  describe('updateStatus', () => {
    async function getItemRow(id: string) {
      const [row] = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)
      return row
    }

    it('updates processing status and clears stale error fields', async () => {
      const seeded = await seedItem()

      const result = await service.updateStatus(seeded.id, 'processing', {
        phase: 'reading'
      })

      expect(result).toMatchObject({
        id: seeded.id,
        status: 'processing',
        phase: 'reading',
        error: null
      })
      await expect(getItemRow(seeded.id)).resolves.toMatchObject({
        status: 'processing',
        phase: 'reading',
        error: null
      })
    })

    it('clears stale phase and error when only status is supplied', async () => {
      const seeded = await seedItem({
        status: 'failed',
        phase: null,
        error: 'previous failure'
      })

      const result = await service.updateStatus(seeded.id, 'processing')

      expect(result).toMatchObject({
        id: seeded.id,
        status: 'processing',
        phase: null,
        error: null
      })
      await expect(getItemRow(seeded.id)).resolves.toMatchObject({
        status: 'processing',
        phase: null,
        error: null
      })
    })

    it('reconciles parent containers after a child reaches a terminal state', async () => {
      await seedItem({
        id: 'dir-root',
        type: 'directory',
        data: { source: '/docs', path: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: 'note-child',
        groupId: 'dir-root',
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing',
        phase: 'reading'
      })

      await service.updateStatus('note-child', 'completed')

      await expect(getItemRow('note-child')).resolves.toMatchObject({
        status: 'completed',
        phase: null,
        error: null
      })
      await expect(getItemRow('dir-root')).resolves.toMatchObject({
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

    it('normalizes failed status to a terminal phase with a non-empty error', async () => {
      const seeded = await seedItem({
        status: 'processing',
        phase: 'reading',
        error: null
      })

      const result = await service.updateStatus(seeded.id, 'failed', { error: '  read failed  ' })

      expect(result).toMatchObject({
        status: 'failed',
        phase: null,
        error: 'read failed'
      })
      await expect(getItemRow(seeded.id)).resolves.toMatchObject({
        status: 'failed',
        phase: null,
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

    it('deletes the owner item and all group members through DB cascade', async () => {
      await seedItem({
        id: 'dir-owner',
        type: 'directory',
        data: { source: '/docs', path: '/docs' }
      })
      await seedItem({
        id: 'child-a',
        groupId: 'dir-owner',
        type: 'note',
        data: { source: 'a', content: 'a' }
      })
      await seedItem({
        id: 'child-b',
        groupId: 'dir-owner',
        type: 'url',
        data: { source: 'https://example.com', url: 'https://example.com' }
      })
      await seedItem({
        id: 'other',
        type: 'note',
        data: { source: 'keep me', content: 'keep me' }
      })

      await service.delete('dir-owner')

      const remaining = await dbh.db.select().from(knowledgeItemTable).orderBy(knowledgeItemTable.id)
      expect(remaining.map((r) => r.id)).toEqual(['other'])
    })

    it('deletes descendants while keeping the requested root items', async () => {
      await seedItem({
        id: 'dir-root',
        type: 'directory',
        data: { source: '/docs', path: '/docs' }
      })
      await seedItem({
        id: 'dir-child',
        groupId: 'dir-root',
        type: 'directory',
        data: { source: '/docs/child', path: '/docs/child' }
      })
      await seedItem({
        id: 'file-grandchild',
        groupId: 'dir-child',
        type: 'file',
        data: createFileItemData('file-grandchild')
      })
      await seedItem({
        id: 'other',
        type: 'note',
        data: { source: 'keep me', content: 'keep me' }
      })

      await service.deleteLeafDescendantItems('kb-1', ['dir-root'])

      const remaining = await dbh.db.select().from(knowledgeItemTable).orderBy(knowledgeItemTable.id)
      expect(remaining.map((r) => r.id)).toEqual(['dir-root', 'other'])
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
        id: 'dir-root',
        type: 'directory',
        data: { source: '/docs', path: '/docs' },
        status: 'processing'
      })

      await service.reconcileContainers('kb-1', ['dir-root'])

      await expect(getItemRow('dir-root')).resolves.toMatchObject({
        id: 'dir-root',
        status: 'completed',
        error: null
      })
    })

    it('marks nested containers completed after leaf descendants are deleted', async () => {
      await seedItem({
        id: 'dir-root',
        type: 'directory',
        data: { source: '/docs', path: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: 'dir-child',
        groupId: 'dir-root',
        type: 'directory',
        data: { source: '/docs/child', path: '/docs/child' },
        status: 'processing'
      })
      await seedItem({
        id: 'note-child',
        groupId: 'dir-child',
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing'
      })
      await service.delete('note-child')

      await service.reconcileContainers('kb-1', ['dir-root'])

      await expect(getItemRow('dir-child')).resolves.toMatchObject({ status: 'completed', error: null })
      await expect(getItemRow('dir-root')).resolves.toMatchObject({ status: 'completed', error: null })
    })

    it('leaves a container processing while any immediate child is active', async () => {
      await seedItem({
        id: 'dir-root',
        type: 'directory',
        data: { source: '/docs', path: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: 'note-child',
        groupId: 'dir-root',
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'processing'
      })

      await service.reconcileContainers('kb-1', ['dir-root'])

      await expect(getItemRow('dir-root')).resolves.toMatchObject({ status: 'processing', error: null })
    })

    it('marks a container failed when all immediate children are terminal and one failed', async () => {
      await seedItem({
        id: 'dir-root',
        type: 'directory',
        data: { source: '/docs', path: '/docs' },
        status: 'processing'
      })
      await seedItem({
        id: 'note-child',
        groupId: 'dir-root',
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'failed',
        error: 'read failed'
      })

      await service.reconcileContainers('kb-1', ['dir-root'])

      await expect(getItemRow('dir-root')).resolves.toMatchObject({
        status: 'failed',
        error: 'One or more child items failed'
      })
    })

    it('does nothing when the root no longer exists', async () => {
      await expect(service.reconcileContainers('kb-1', ['missing-root'])).resolves.toBeUndefined()
    })

    it('reconciles containers bottom-up after active leaves are deleted', async () => {
      await seedItem({
        id: 'dir-a',
        type: 'directory',
        data: { source: '/docs/a', path: '/docs/a' },
        status: 'processing'
      })
      await seedItem({
        id: 'file-a',
        groupId: 'dir-a',
        type: 'file',
        data: createFileItemData('file-a'),
        status: 'processing'
      })
      await seedItem({
        id: 'dir-b',
        groupId: 'dir-a',
        type: 'directory',
        data: { source: '/docs/a/b', path: '/docs/a/b' },
        status: 'processing'
      })
      await seedItem({
        id: 'file-b',
        groupId: 'dir-b',
        type: 'file',
        data: createFileItemData('file-b'),
        status: 'processing'
      })

      await service.delete('file-b')

      await expect(getItemRow('dir-b')).resolves.toMatchObject({ status: 'completed', error: null })
      await expect(getItemRow('dir-a')).resolves.toMatchObject({ status: 'processing', error: null })

      await service.delete('file-a')

      await expect(getItemRow('dir-a')).resolves.toMatchObject({ status: 'completed', error: null })
    })
  })
})
