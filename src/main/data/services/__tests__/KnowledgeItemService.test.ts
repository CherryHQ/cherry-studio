import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import { ErrorCode } from '@shared/data/api'
import type { CreateKnowledgeRootChildrenDto, UpdateKnowledgeItemDto } from '@shared/data/api/schemas/knowledges'
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

let currentDb: DbType | typeof mockDb = mockDb
let closeClient: (() => void) | undefined

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn(() => ({
      getDb: vi.fn(() => currentDb)
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
    parentId: null,
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
  let service: ReturnType<typeof KnowledgeItemService.getInstance>

  beforeEach(() => {
    mockSelect.mockReset()
    mockInsert.mockReset()
    mockUpdate.mockReset()
    mockDelete.mockReset()
    getKnowledgeBaseByIdMock.mockReset()
    getKnowledgeBaseByIdMock.mockResolvedValue({ id: 'kb-1' })
    currentDb = mockDb
    service = KnowledgeItemService.getInstance()
  })

  afterEach(() => {
    closeClient?.()
    closeClient = undefined
  })

  describe('listRootChildren', () => {
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

    it('should return paginated root children for a knowledge base', async () => {
      setupListMocks([createMockRow({ data: JSON.stringify({ content: 'hello world' }) })], 1)

      const result = await service.listRootChildren('kb-1', { page: 1, limit: 20 })

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

    it('should support type-filtered root listings', async () => {
      setupListMocks([createMockRow({ id: 'item-2', type: 'directory', parentId: null })], 1)

      const result = await service.listRootChildren('kb-1', { page: 2, limit: 10, type: 'directory' })

      expect(result.page).toBe(2)
      expect(result.items[0]).toMatchObject({
        id: 'item-2',
        parentId: null,
        type: 'directory'
      })
    })
  })

  describe('listChildren', () => {
    function setupChildListMocks(parent: Record<string, unknown>, rows: Record<string, unknown>[], count: number) {
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([parent])
          })
        })
      })
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

    it('should return direct children for one knowledge item', async () => {
      setupChildListMocks(
        createMockRow({ id: 'directory-1', baseId: 'kb-1', type: 'directory' }),
        [createMockRow({ id: 'child-1', parentId: 'directory-1', type: 'note' })],
        1
      )

      const result = await service.listChildren('directory-1', { page: 1, limit: 20 })

      expect(result).toMatchObject({
        total: 1,
        page: 1
      })
      expect(result.items[0]).toMatchObject({
        id: 'child-1',
        parentId: 'directory-1',
        type: 'note'
      })
    })
  })

  describe('createRootChildren', () => {
    it('should create and return root knowledge items', async () => {
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

      const dto: CreateKnowledgeRootChildrenDto = {
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

      const result = await service.createRootChildren('kb-1', dto)

      expect(values).toHaveBeenCalledWith([
        {
          baseId: 'kb-1',
          parentId: null,
          type: 'directory',
          data: { path: '/tmp/files', recursive: true },
          status: 'idle',
          error: null
        },
        {
          baseId: 'kb-1',
          parentId: null,
          type: 'note',
          data: { content: 'child note' },
          status: 'idle',
          error: null
        }
      ])
      expect(result.items).toHaveLength(2)
      expect(result.items[1]).toMatchObject({
        id: 'item-2',
        parentId: null,
        type: 'note'
      })
    })
  })

  describe('query semantics (db-backed)', () => {
    beforeEach(async () => {
      const client = createClient({ url: 'file::memory:' })
      closeClient = () => client.close()
      currentDb = drizzle({
        client,
        casing: 'snake_case'
      })

      await currentDb.run(sql`PRAGMA foreign_keys = ON`)
      await currentDb.run(
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
          updated_at INTEGER
        )
      `)
      )
      await currentDb.run(
        sql.raw(`
        CREATE TABLE knowledge_item (
          id TEXT PRIMARY KEY NOT NULL,
          base_id TEXT NOT NULL,
          parent_id TEXT,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'idle',
          error TEXT,
          created_at INTEGER,
          updated_at INTEGER,
          FOREIGN KEY (base_id) REFERENCES knowledge_base(id) ON DELETE CASCADE,
          FOREIGN KEY (base_id, parent_id) REFERENCES knowledge_item(base_id, id) ON DELETE CASCADE,
          CONSTRAINT knowledge_item_base_id_id_unique UNIQUE (base_id, id)
        )
      `)
      )

      await currentDb.insert(knowledgeBaseTable).values({
        id: 'kb-1',
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'openai::text-embedding-3-large'
      })

      await currentDb.insert(knowledgeItemTable).values([
        {
          id: 'dir-a',
          baseId: 'kb-1',
          parentId: null,
          type: 'directory',
          data: { path: '/a', recursive: true },
          status: 'idle',
          error: null,
          createdAt: 100
        },
        {
          id: 'dir-b',
          baseId: 'kb-1',
          parentId: null,
          type: 'directory',
          data: { path: '/b', recursive: true },
          status: 'idle',
          error: null,
          createdAt: 90
        },
        {
          id: 'note-root',
          baseId: 'kb-1',
          parentId: null,
          type: 'note',
          data: { content: 'root note' },
          status: 'idle',
          error: null,
          createdAt: 80
        },
        {
          id: 'file-root',
          baseId: 'kb-1',
          parentId: null,
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
          id: 'dir-c',
          baseId: 'kb-1',
          parentId: 'dir-a',
          type: 'directory',
          data: { path: '/a/c', recursive: true },
          status: 'idle',
          error: null,
          createdAt: 60
        },
        {
          id: 'file-child',
          baseId: 'kb-1',
          parentId: 'dir-a',
          type: 'file',
          data: {
            file: {
              id: 'file-2',
              name: 'child.txt',
              origin_name: 'child.txt',
              path: '/a/child.txt',
              size: 20,
              ext: '.txt',
              type: 'text',
              created_at: '2024-01-01T00:00:00.000Z',
              count: 1
            }
          },
          status: 'idle',
          error: null,
          createdAt: 50
        },
        {
          id: 'note-grandchild',
          baseId: 'kb-1',
          parentId: 'dir-c',
          type: 'note',
          data: { content: 'grandchild' },
          status: 'idle',
          error: null,
          createdAt: 40
        }
      ])
    })

    it('listRootChildren returns only root-level nodes for the requested type', async () => {
      const result = await service.listRootChildren('kb-1', {
        page: 1,
        limit: 20,
        type: 'directory'
      })

      expect(result.items.map((item) => item.id)).toEqual(['dir-a', 'dir-b'])
    })

    it('listChildren returns only direct children of the requested parent', async () => {
      const result = await service.listChildren('dir-a', {
        page: 1,
        limit: 20
      })

      expect(result.items.map((item) => item.id)).toEqual(['dir-c', 'file-child'])
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
    it('should delete the requested node by id and rely on DB cascade for descendants', async () => {
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
