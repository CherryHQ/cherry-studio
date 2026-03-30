import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import { ErrorCode } from '@shared/data/api'
import type { CreateKnowledgeItemsDto, UpdateKnowledgeItemDto } from '@shared/data/api/schemas/knowledges'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getKnowledgeBaseByIdMock } = vi.hoisted(() => ({
  getKnowledgeBaseByIdMock: vi.fn()
}))

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete
}

let realDb: DbType | null = null
let closeClient: (() => void) | undefined

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn(() => ({
      getDb: vi.fn(() => realDb ?? mockDb)
    }))
  }
}))

vi.mock('../KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    getById: getKnowledgeBaseByIdMock
  }
}))

const { KnowledgeItemService } = await import('../KnowledgeItemService')

function createMockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    baseId: 'kb-1',
    groupId: null,
    type: 'note',
    data: { content: 'hello world' },
    status: 'idle',
    error: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides
  }
}

describe('KnowledgeItemService', () => {
  let service: InstanceType<typeof KnowledgeItemService>

  beforeEach(() => {
    mockSelect.mockReset()
    mockInsert.mockReset()
    mockUpdate.mockReset()
    mockDelete.mockReset()
    getKnowledgeBaseByIdMock.mockReset()
    getKnowledgeBaseByIdMock.mockResolvedValue({ id: 'kb-1' })
    realDb = null
    service = new KnowledgeItemService()
  })

  afterEach(() => {
    closeClient?.()
    closeClient = undefined
    realDb = null
  })

  describe('list', () => {
    function setupListMocks(rows: Record<string, unknown>[], count: number) {
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(rows)
              })
            })
          })
        })
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count }])
        })
      })
    }

    it('should return paginated knowledge items for a knowledge base', async () => {
      setupListMocks([createMockRow({ data: JSON.stringify({ content: 'hello world' }) })], 1)

      const result = await service.list('kb-1', { page: 1, limit: 20 })

      expect(getKnowledgeBaseByIdMock).toHaveBeenCalledWith('kb-1')
      expect(result).toMatchObject({
        total: 1,
        page: 1
      })
      expect(result.items[0]).toMatchObject({
        id: 'item-1',
        baseId: 'kb-1',
        type: 'note',
        data: {
          content: 'hello world'
        }
      })
    })

    it('should support type/group filters', async () => {
      setupListMocks(
        [
          createMockRow({
            id: 'item-2',
            type: 'directory',
            groupId: 'group-1'
          })
        ],
        1
      )

      const result = await service.list('kb-1', {
        page: 2,
        limit: 10,
        type: 'directory',
        groupId: 'group-1'
      })

      expect(result.page).toBe(2)
      expect(result.items[0]).toMatchObject({
        id: 'item-2',
        groupId: 'group-1',
        type: 'directory'
      })
    })
  })

  describe('createMany', () => {
    it('should create and return knowledge items', async () => {
      const values = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          createMockRow({
            id: 'item-1',
            type: 'directory',
            data: { path: '/tmp/files', recursive: true }
          }),
          createMockRow({
            id: 'item-2',
            type: 'note',
            data: { content: 'child note' }
          })
        ])
      })
      mockInsert.mockReturnValue({ values })

      const dto: CreateKnowledgeItemsDto = {
        items: [
          {
            type: 'directory',
            data: { path: '/tmp/files', recursive: true }
          },
          {
            type: 'note',
            data: { content: 'child note' }
          }
        ]
      }

      const result = await service.createMany('kb-1', dto)

      expect(values).toHaveBeenCalledWith([
        {
          baseId: 'kb-1',
          groupId: null,
          type: 'directory',
          data: { path: '/tmp/files', recursive: true },
          status: 'idle',
          error: null
        },
        {
          baseId: 'kb-1',
          groupId: null,
          type: 'note',
          data: { content: 'child note' },
          status: 'idle',
          error: null
        }
      ])
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toMatchObject({
        id: 'item-1'
      })
    })

    it('should reject invalid item data with validation error before insert', async () => {
      await expect(
        service.createMany('kb-1', {
          items: [
            {
              type: 'note',
              data: {} as any
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

      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('should reject nonexistent groupId with validation error before insert', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      })

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

      expect(mockInsert).not.toHaveBeenCalled()
    })
  })

  describe('query semantics (db-backed)', () => {
    beforeEach(async () => {
      const client = createClient({ url: 'file::memory:' })
      closeClient = () => client.close()
      realDb = drizzle({
        client,
        casing: 'snake_case'
      })
      const db = realDb

      await db.run(sql`PRAGMA foreign_keys = ON`)
      await db.run(
        sql.raw(`
        CREATE TABLE knowledge_base (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          dimensions INTEGER NOT NULL,
          embedding_model_id TEXT NOT NULL,
          rerank_model_id TEXT,
          file_processor_id TEXT,
          chunk_size INTEGER,
          chunk_overlap INTEGER,
          threshold REAL,
          document_count INTEGER,
          search_mode TEXT,
          hybrid_alpha REAL,
          created_at INTEGER,
          updated_at INTEGER,
          CONSTRAINT knowledge_base_search_mode_check CHECK (search_mode IN ('default', 'bm25', 'hybrid') OR search_mode IS NULL)
        )
      `)
      )
      await db.run(
        sql.raw(`
        CREATE TABLE knowledge_item (
          id TEXT PRIMARY KEY NOT NULL,
          base_id TEXT NOT NULL,
          group_id TEXT,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'idle',
          error TEXT,
          created_at INTEGER,
          updated_at INTEGER,
          CONSTRAINT knowledge_item_type_check CHECK (type IN ('file', 'url', 'note', 'sitemap', 'directory')),
          CONSTRAINT knowledge_item_status_check CHECK (status IN ('idle', 'pending', 'ocr', 'read', 'embed', 'completed', 'failed')),
          FOREIGN KEY (base_id) REFERENCES knowledge_base(id) ON DELETE CASCADE,
          FOREIGN KEY (base_id, group_id) REFERENCES knowledge_item(base_id, id) ON DELETE CASCADE,
          CONSTRAINT knowledge_item_baseId_id_unique UNIQUE (base_id, id)
        )
      `)
      )

      await db.insert(knowledgeBaseTable).values({
        id: 'kb-1',
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'openai::text-embedding-3-large'
      })

      await db.insert(knowledgeItemTable).values([
        {
          id: 'dir-a',
          baseId: 'kb-1',
          groupId: null,
          type: 'directory',
          data: { path: '/a', recursive: true },
          status: 'idle',
          error: null,
          createdAt: 100
        },
        {
          id: 'dir-b',
          baseId: 'kb-1',
          groupId: null,
          type: 'directory',
          data: { path: '/b', recursive: true },
          status: 'idle',
          error: null,
          createdAt: 90
        },
        {
          id: 'note-group-a',
          baseId: 'kb-1',
          groupId: 'dir-a',
          type: 'note',
          data: { content: 'group note' },
          status: 'idle',
          error: null,
          createdAt: 80
        },
        {
          id: 'file-group-none',
          baseId: 'kb-1',
          groupId: null,
          type: 'file',
          data: {
            file: {
              id: 'file-1',
              name: 'file.txt',
              origin_name: 'file.txt',
              path: '/file.txt',
              size: 10,
              ext: '.txt',
              type: 'text',
              created_at: '2024-01-01T00:00:00.000Z',
              count: 1
            }
          },
          status: 'idle',
          error: null,
          createdAt: 70
        },
        {
          id: 'note-plain',
          baseId: 'kb-1',
          groupId: null,
          type: 'note',
          data: { content: 'plain note' },
          status: 'idle',
          error: null,
          createdAt: 60
        }
      ])
    })

    it('list returns only items of the requested type', async () => {
      const result = await service.list('kb-1', {
        page: 1,
        limit: 20,
        type: 'directory'
      })

      expect(result.items.map((item) => item.id)).toEqual(['dir-a', 'dir-b'])
    })

    it('list returns only items of the requested group', async () => {
      const result = await service.list('kb-1', {
        page: 1,
        limit: 20,
        groupId: 'dir-a'
      })

      expect(result.items.map((item) => item.id)).toEqual(['note-group-a'])
    })

    it('db check constraints reject invalid knowledge enums', async () => {
      const db = realDb!

      await expect(
        db.run(
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
        db.run(
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
      const db = realDb!

      await db.insert(knowledgeBaseTable).values({
        id: 'kb-2',
        name: 'KB 2',
        dimensions: 1024,
        embeddingModelId: 'openai::text-embedding-3-large'
      })

      await expect(
        db.insert(knowledgeItemTable).values({
          id: 'cross-base-child',
          baseId: 'kb-2',
          groupId: 'dir-a',
          type: 'note',
          data: { content: 'invalid cross-base group' },
          status: 'idle',
          error: null,
          createdAt: 50
        })
      ).rejects.toThrow()
    })

    it('createMany accepts groupId when the owner already exists in the same base', async () => {
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
        type: 'note',
        data: { content: 'new grouped note' }
      })
    })
  })

  describe('getById', () => {
    it('should return a knowledge item by id', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow({ data: JSON.stringify({ content: 'stored note' }) })])
          })
        })
      })

      const result = await service.getById('item-1')

      expect(result).toMatchObject({
        id: 'item-1',
        data: {
          content: 'stored note'
        }
      })
    })

    it('should throw NotFound when the knowledge item does not exist', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      await expect(service.getById('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })

    it('should surface malformed stored item data as DATA_INCONSISTENT', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow({ id: 'broken-item', data: '{bad json' })])
          })
        })
      })

      await expect(service.getById('broken-item')).rejects.toMatchObject({
        code: ErrorCode.DATA_INCONSISTENT,
        status: 409,
        message: expect.stringContaining("Corrupted data in knowledge item 'broken-item'")
      })
    })

    it('should surface null stored item data as DATA_INCONSISTENT', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow({ id: 'null-item', data: null })])
          })
        })
      })

      await expect(service.getById('null-item')).rejects.toMatchObject({
        code: ErrorCode.DATA_INCONSISTENT,
        status: 409,
        message: expect.stringContaining("Knowledge item 'null-item' has missing or null data")
      })
    })
  })

  describe('update', () => {
    it('should return the existing item when update is empty', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow()])
          })
        })
      })

      const result = await service.update('item-1', {})

      expect(result.id).toBe('item-1')
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('should reject data that does not match the existing item type', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow({ type: 'note', data: { content: 'stored note' } })])
          })
        })
      })

      await expect(
        service.update('item-1', {
          data: { path: '/tmp/files', recursive: true }
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            data: ["Data payload does not match the existing knowledge item type 'note'"]
          }
        }
      })

      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('should update and return the knowledge item', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow()])
          })
        })
      })
      const set = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            createMockRow({
              status: 'completed',
              error: null,
              data: { content: 'updated note' }
            })
          ])
        })
      })
      mockUpdate.mockReturnValue({ set })

      const dto: UpdateKnowledgeItemDto = {
        status: 'completed',
        error: null,
        data: { content: 'updated note' }
      }

      const result = await service.update('item-1', dto)

      expect(set).toHaveBeenCalledWith({
        data: { content: 'updated note' },
        status: 'completed',
        error: null
      })
      expect(result).toMatchObject({
        id: 'item-1',
        status: 'completed',
        data: {
          content: 'updated note'
        }
      })
    })
  })

  describe('delete', () => {
    it('should delete the requested knowledge item group by id', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow()])
          })
        })
      })
      const where = vi.fn().mockResolvedValue(undefined)
      mockDelete.mockReturnValue({ where })

      await expect(service.delete('item-1')).resolves.toBeUndefined()
      expect(mockSelect).toHaveBeenCalledTimes(1)
      expect(where).toHaveBeenCalledTimes(1)
    })

    it('should delete the owner item and all group members in db-backed mode', async () => {
      const client = createClient({ url: 'file::memory:' })
      closeClient = () => client.close()
      realDb = drizzle({
        client,
        casing: 'snake_case'
      })
      const db = realDb

      await db.run(sql`PRAGMA foreign_keys = ON`)
      await db.run(
        sql.raw(`
        CREATE TABLE knowledge_base (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          dimensions INTEGER NOT NULL,
          embedding_model_id TEXT NOT NULL,
          rerank_model_id TEXT,
          file_processor_id TEXT,
          chunk_size INTEGER,
          chunk_overlap INTEGER,
          threshold REAL,
          document_count INTEGER,
          search_mode TEXT,
          hybrid_alpha REAL,
          created_at INTEGER,
          updated_at INTEGER,
          CONSTRAINT knowledge_base_search_mode_check CHECK (search_mode IN ('default', 'bm25', 'hybrid') OR search_mode IS NULL)
        )
      `)
      )
      await db.run(
        sql.raw(`
        CREATE TABLE knowledge_item (
          id TEXT PRIMARY KEY NOT NULL,
          base_id TEXT NOT NULL,
          group_id TEXT,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'idle',
          error TEXT,
          created_at INTEGER,
          updated_at INTEGER,
          CONSTRAINT knowledge_item_type_check CHECK (type IN ('file', 'url', 'note', 'sitemap', 'directory')),
          CONSTRAINT knowledge_item_status_check CHECK (status IN ('idle', 'pending', 'ocr', 'read', 'embed', 'completed', 'failed')),
          FOREIGN KEY (base_id) REFERENCES knowledge_base(id) ON DELETE CASCADE,
          FOREIGN KEY (base_id, group_id) REFERENCES knowledge_item(base_id, id) ON DELETE CASCADE,
          CONSTRAINT knowledge_item_baseId_id_unique UNIQUE (base_id, id)
        )
      `)
      )

      await db.insert(knowledgeBaseTable).values({
        id: 'kb-delete',
        name: 'KB delete',
        dimensions: 1024,
        embeddingModelId: 'openai::text-embedding-3-large'
      })

      await db.insert(knowledgeItemTable).values([
        {
          id: 'dir-owner',
          baseId: 'kb-delete',
          groupId: null,
          type: 'directory',
          data: { path: '/docs', recursive: true },
          status: 'idle',
          error: null,
          createdAt: 100
        },
        {
          id: 'child-a',
          baseId: 'kb-delete',
          groupId: 'dir-owner',
          type: 'note',
          data: { content: 'a' },
          status: 'idle',
          error: null,
          createdAt: 90
        },
        {
          id: 'child-b',
          baseId: 'kb-delete',
          groupId: 'dir-owner',
          type: 'url',
          data: { url: 'https://example.com', name: 'example' },
          status: 'idle',
          error: null,
          createdAt: 80
        },
        {
          id: 'other-item',
          baseId: 'kb-delete',
          groupId: null,
          type: 'note',
          data: { content: 'keep me' },
          status: 'idle',
          error: null,
          createdAt: 70
        }
      ])

      await service.delete('dir-owner')

      const remaining = await db.select().from(knowledgeItemTable).orderBy(knowledgeItemTable.id)
      expect(remaining.map((item) => item.id)).toEqual(['other-item'])
    })

    it('should throw NotFound when deleting a missing knowledge item', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      await expect(service.delete('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })
})
