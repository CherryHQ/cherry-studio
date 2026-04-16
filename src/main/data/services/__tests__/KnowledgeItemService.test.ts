import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { KnowledgeItemService } from '@data/services/KnowledgeItemService'
import { ErrorCode } from '@shared/data/api'
import type { CreateKnowledgeItemsDto, UpdateKnowledgeItemDto } from '@shared/data/api/schemas/knowledges'
import { setupTestDatabase } from '@test-helpers/db'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

describe('KnowledgeItemService', () => {
  const dbh = setupTestDatabase()
  let service: KnowledgeItemService

  beforeEach(async () => {
    service = new KnowledgeItemService()
    // Seed a knowledge base so FK-constrained inserts pass and
    // knowledgeBaseService.getById('kb-1') resolves the existing row.
    await dbh.db.insert(knowledgeBaseTable).values({
      id: 'kb-1',
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'openai::text-embedding-3-large'
    })
  })

  async function seedItem(overrides: Partial<typeof knowledgeItemTable.$inferInsert> = {}) {
    const values: typeof knowledgeItemTable.$inferInsert = {
      baseId: 'kb-1',
      groupId: null,
      type: 'note',
      data: { content: 'hello world' },
      status: 'idle',
      error: null,
      ...overrides
    }
    const [inserted] = await dbh.db.insert(knowledgeItemTable).values(values).returning()
    return inserted
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

    it('returns only items of the requested type', async () => {
      await seedItem({ id: 'dir-a', type: 'directory', data: { name: 'a', path: '/a' } })
      await seedItem({ id: 'dir-b', type: 'directory', data: { name: 'b', path: '/b' } })
      await seedItem({ id: 'note-1', type: 'note', data: { content: 'n1' } })

      const result = await service.list('kb-1', {
        page: 1,
        limit: 20,
        type: 'directory'
      })

      expect(result.items.map((item) => item.id).sort()).toEqual(['dir-a', 'dir-b'])
    })

    it('returns only items of the requested group', async () => {
      await seedItem({ id: 'dir-a', type: 'directory', data: { name: 'a', path: '/a' } })
      await seedItem({
        id: 'note-child',
        groupId: 'dir-a',
        type: 'note',
        data: { content: 'child' }
      })

      const result = await service.list('kb-1', {
        page: 1,
        limit: 20,
        groupId: 'dir-a'
      })

      expect(result.items.map((item) => item.id)).toEqual(['note-child'])
    })
  })

  describe('getById', () => {
    it('returns a knowledge item by id', async () => {
      const seeded = await seedItem({ data: { content: 'stored note' } })

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

    it('surfaces malformed stored item data as DATA_INCONSISTENT', async () => {
      await seedItem({ id: 'broken' })
      // Directly write a corrupt JSON blob to simulate bit rot / manual
      // SQL tampering. Drizzle's `text({ mode: 'json' })` decoder will
      // throw a raw SyntaxError at query materialisation time — the fix
      // wraps the read in awaitKnowledgeItemRead which converts that
      // into a proper DATA_INCONSISTENT response.
      await dbh.client.execute({
        sql: "UPDATE knowledge_item SET data = '{bad json' WHERE id = ?",
        args: ['broken']
      })

      await expect(service.getById('broken')).rejects.toMatchObject({
        code: ErrorCode.DATA_INCONSISTENT,
        status: 409,
        message: expect.stringContaining("Corrupted data in knowledge item 'broken'")
      })
    })

    it('surfaces null stored item data as DATA_INCONSISTENT', async () => {
      await seedItem({ id: 'null-item' })
      // A valid-JSON-but-null blob reaches rowToKnowledgeItem() with
      // row.data === null, which triggers the null guard (distinct from
      // the corrupt-parse guard above).
      await dbh.client.execute({
        sql: "UPDATE knowledge_item SET data = 'null' WHERE id = ?",
        args: ['null-item']
      })

      await expect(service.getById('null-item')).rejects.toMatchObject({
        code: ErrorCode.DATA_INCONSISTENT,
        status: 409,
        message: expect.stringContaining("Knowledge item 'null-item' has missing or null data")
      })
    })
  })

  describe('createMany', () => {
    it('creates knowledge items and returns them', async () => {
      const dto: CreateKnowledgeItemsDto = {
        items: [
          {
            type: 'directory',
            data: { name: 'files', path: '/tmp/files' }
          },
          {
            type: 'note',
            data: { content: 'child note' }
          }
        ]
      }

      const result = await service.createMany('kb-1', dto)

      expect(result.items).toHaveLength(2)
      const rows = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.baseId, 'kb-1'))
      expect(rows).toHaveLength(2)
    })

    it('creates grouped items that reference a batch-local parent by groupRef', async () => {
      const result = await service.createMany('kb-1', {
        items: [
          {
            ref: 'root',
            type: 'directory',
            data: { name: 'files', path: '/tmp/files' }
          },
          {
            groupRef: 'root',
            type: 'note',
            data: { content: 'child note' }
          }
        ]
      })

      expect(result.items).toHaveLength(2)
      const rootItem = result.items.find((i) => i.type === 'directory')!
      const noteItem = result.items.find((i) => i.type === 'note')!
      expect(noteItem.groupId).toBe(rootItem.id)
    })

    it('rejects invalid item data with validation error before insert', async () => {
      await expect(
        service.createMany('kb-1', {
          items: [
            {
              type: 'note',
              data: {} as never
            }
          ]
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            'items.0.data': ["Data payload does not match knowledge item type 'note'"]
          }
        }
      })

      const rows = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.baseId, 'kb-1'))
      expect(rows).toHaveLength(0)
    })

    it('rejects nonexistent groupId with validation error before insert', async () => {
      await expect(
        service.createMany('kb-1', {
          items: [
            {
              groupId: 'missing-owner',
              type: 'note',
              data: { content: 'child note' }
            }
          ]
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

    it('accepts groupId when the owner already exists in the same base', async () => {
      await seedItem({ id: 'dir-a', type: 'directory', data: { name: 'a', path: '/a' } })

      const result = await service.createMany('kb-1', {
        items: [
          {
            groupId: 'dir-a',
            type: 'note',
            data: { content: 'new grouped note' }
          }
        ]
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        baseId: 'kb-1',
        groupId: 'dir-a',
        type: 'note'
      })
    })

    it('accepts multi-level groupRef trees in one batch', async () => {
      const result = await service.createMany('kb-1', {
        items: [
          {
            ref: 'dir-a',
            type: 'directory',
            data: { name: 'a', path: '/a' }
          },
          {
            ref: 'dir-b',
            groupRef: 'dir-a',
            type: 'directory',
            data: { name: 'b', path: '/a/b' }
          },
          {
            groupRef: 'dir-b',
            type: 'note',
            data: { content: 'nested note' }
          }
        ]
      })

      expect(result.items).toHaveLength(3)
      const dirA = result.items.find((i) => i.type === 'directory' && i.data.path === '/a')
      const dirB = result.items.find((i) => i.type === 'directory' && i.data.path === '/a/b')
      const note = result.items.find((i) => i.type === 'note')
      expect(dirA?.groupId).toBeNull()
      expect(dirB?.groupId).toBe(dirA?.id)
      expect(note?.groupId).toBe(dirB?.id)
    })

    it('rejects self-referencing groupRef items', async () => {
      await expect(
        service.createMany('kb-1', {
          items: [
            {
              ref: 'self',
              groupRef: 'self',
              type: 'note',
              data: { content: 'self ref' }
            }
          ]
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            groupRef: ['Knowledge item cannot reference itself as group owner']
          }
        }
      })
    })

    it('rejects two-node groupRef cycles', async () => {
      await expect(
        service.createMany('kb-1', {
          items: [
            { ref: 'a', groupRef: 'b', type: 'note', data: { content: 'A' } },
            { ref: 'b', groupRef: 'a', type: 'note', data: { content: 'B' } }
          ]
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            groupRef: ['Knowledge item grouping cannot contain cycles within one request batch']
          }
        }
      })
    })
  })

  describe('query semantics (db-backed)', () => {
    it('getCascadeIdsInBase returns root ids with recursive descendants', async () => {
      await seedItem({ id: 'dir-a', type: 'directory', data: { name: 'a', path: '/a' } })
      await seedItem({
        id: 'note-child',
        groupId: 'dir-a',
        type: 'note',
        data: { content: 'child' }
      })
      await seedItem({
        id: 'note-grandchild',
        groupId: 'note-child',
        type: 'note',
        data: { content: 'grandchild' }
      })

      const result = await service.getCascadeIdsInBase('kb-1', ['dir-a'])

      expect(result).toEqual(['dir-a', 'note-child', 'note-grandchild'])
    })

    it('getByIdsInBase returns items in input order for one base', async () => {
      await seedItem({ id: 'dir-a', type: 'directory', data: { name: 'a', path: '/a' } })
      await seedItem({ id: 'note-plain', type: 'note', data: { content: 'plain' } })

      const result = await service.getByIdsInBase('kb-1', ['note-plain', 'dir-a'])

      expect(result.map((i) => i.id)).toEqual(['note-plain', 'dir-a'])
    })

    it('getByIdsInBase throws when any requested item is outside the base or missing', async () => {
      await seedItem({ id: 'note-plain', type: 'note', data: { content: 'plain' } })

      await expect(service.getByIdsInBase('kb-1', ['note-plain', 'missing-item'])).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })

    it('db check constraints reject invalid knowledge enums', async () => {
      await expect(
        dbh.db.run(
          sql.raw(`
            INSERT INTO knowledge_base (
              id, name, dimensions, embedding_model_id, search_mode
            ) VALUES (
              'kb-invalid-enum', 'KB invalid enum', 1024, 'openai::text-embedding-3-large', 'vector'
            )
          `)
        )
      ).rejects.toThrow()

      await expect(
        dbh.db.run(
          sql.raw(`
            INSERT INTO knowledge_item (
              id, base_id, group_id, type, data, status
            ) VALUES (
              'item-invalid-enum', 'kb-1', NULL, 'memory', '{}', 'done'
            )
          `)
        )
      ).rejects.toThrow()
    })

    it('db rejects cross-base group ownership references', async () => {
      await dbh.db.insert(knowledgeBaseTable).values({
        id: 'kb-2',
        name: 'KB 2',
        dimensions: 1024,
        embeddingModelId: 'openai::text-embedding-3-large'
      })
      await seedItem({ id: 'dir-a', type: 'directory', data: { name: 'a', path: '/a' } })

      await expect(
        dbh.db.insert(knowledgeItemTable).values({
          baseId: 'kb-2',
          groupId: 'dir-a',
          type: 'note',
          data: { content: 'cross-base child' },
          status: 'idle'
        })
      ).rejects.toThrow()
    })
  })

  describe('update', () => {
    it('returns the existing item when update is empty', async () => {
      const seeded = await seedItem()

      const result = await service.update(seeded.id, {})

      expect(result.id).toBe(seeded.id)
    })

    it('rejects data that does not match the existing item type', async () => {
      const seeded = await seedItem({ type: 'note', data: { content: 'note' } })

      await expect(
        service.update(seeded.id, {
          data: { name: 'files', path: '/tmp/files' } as never
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            data: ["Data payload does not match the existing knowledge item type 'note'"]
          }
        }
      })
    })

    it('updates status/data of an existing item', async () => {
      const seeded = await seedItem()

      const dto: UpdateKnowledgeItemDto = {
        status: 'completed',
        error: null,
        data: { content: 'updated note' }
      }

      const result = await service.update(seeded.id, dto)

      expect(result).toMatchObject({
        id: seeded.id,
        status: 'completed',
        data: { content: 'updated note' }
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

    it('deletes the owner item and all group members (cascade)', async () => {
      await seedItem({
        id: 'dir-owner',
        type: 'directory',
        data: { name: 'docs', path: '/docs' }
      })
      await seedItem({
        id: 'child-a',
        groupId: 'dir-owner',
        type: 'note',
        data: { content: 'a' }
      })
      await seedItem({
        id: 'child-b',
        groupId: 'dir-owner',
        type: 'url',
        data: { url: 'https://example.com', name: 'example' }
      })
      await seedItem({
        id: 'other',
        type: 'note',
        data: { content: 'keep me' }
      })

      await service.delete('dir-owner')

      const remaining = await dbh.db.select().from(knowledgeItemTable).orderBy(knowledgeItemTable.id)
      expect(remaining.map((r) => r.id)).toEqual(['other'])
    })

    it('throws NotFound when deleting a missing knowledge item', async () => {
      await expect(service.delete('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })
})
