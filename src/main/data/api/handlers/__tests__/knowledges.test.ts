import type { CreateKnowledgeRootChildrenDto } from '@shared/data/api/schemas/knowledges'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listKnowledgeBasesMock,
  createKnowledgeBaseMock,
  getKnowledgeBaseByIdMock,
  updateKnowledgeBaseMock,
  deleteKnowledgeBaseMock,
  listKnowledgeRootChildrenMock,
  createKnowledgeRootChildrenMock,
  listKnowledgeItemChildrenMock,
  getKnowledgeItemByIdMock,
  updateKnowledgeItemMock,
  deleteKnowledgeItemMock
} = vi.hoisted(() => ({
  listKnowledgeBasesMock: vi.fn(),
  createKnowledgeBaseMock: vi.fn(),
  getKnowledgeBaseByIdMock: vi.fn(),
  updateKnowledgeBaseMock: vi.fn(),
  deleteKnowledgeBaseMock: vi.fn(),
  listKnowledgeRootChildrenMock: vi.fn(),
  createKnowledgeRootChildrenMock: vi.fn(),
  listKnowledgeItemChildrenMock: vi.fn(),
  getKnowledgeItemByIdMock: vi.fn(),
  updateKnowledgeItemMock: vi.fn(),
  deleteKnowledgeItemMock: vi.fn()
}))

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    list: listKnowledgeBasesMock,
    create: createKnowledgeBaseMock,
    getById: getKnowledgeBaseByIdMock,
    update: updateKnowledgeBaseMock,
    delete: deleteKnowledgeBaseMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    listRootChildren: listKnowledgeRootChildrenMock,
    createRootChildren: createKnowledgeRootChildrenMock,
    listChildren: listKnowledgeItemChildrenMock,
    getById: getKnowledgeItemByIdMock,
    update: updateKnowledgeItemMock,
    delete: deleteKnowledgeItemMock
  }
}))

import {
  KNOWLEDGE_BASES_DEFAULT_LIMIT,
  KNOWLEDGE_BASES_DEFAULT_PAGE,
  KNOWLEDGE_BASES_MAX_LIMIT,
  KNOWLEDGE_ITEMS_DEFAULT_LIMIT,
  KNOWLEDGE_ITEMS_DEFAULT_PAGE,
  KNOWLEDGE_ITEMS_MAX_LIMIT
} from '@shared/data/api/schemas/knowledges'

import { knowledgeHandlers } from '../knowledges'

describe('knowledgeHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/knowledge-bases', () => {
    it('should apply default pagination when query is missing', async () => {
      const response = {
        items: [{ id: 'kb-1', name: 'Knowledge Base' }],
        total: 1,
        page: KNOWLEDGE_BASES_DEFAULT_PAGE
      }
      listKnowledgeBasesMock.mockResolvedValueOnce(response)

      const result = await knowledgeHandlers['/knowledge-bases'].GET({})

      expect(listKnowledgeBasesMock).toHaveBeenCalledWith({
        page: KNOWLEDGE_BASES_DEFAULT_PAGE,
        limit: KNOWLEDGE_BASES_DEFAULT_LIMIT
      })
      expect(result).toEqual(response)
    })

    it('should delegate explicit pagination to knowledgeBaseService.list', async () => {
      const response = {
        items: [{ id: 'kb-2', name: 'Knowledge Base 2' }],
        total: 3,
        page: 2
      }
      listKnowledgeBasesMock.mockResolvedValueOnce(response)

      const result = await knowledgeHandlers['/knowledge-bases'].GET({
        query: {
          page: 2,
          limit: 10
        } as never
      } as never)

      expect(listKnowledgeBasesMock).toHaveBeenCalledWith({
        page: 2,
        limit: 10
      })
      expect(result).toEqual(response)
    })

    it('should reject invalid pagination before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases'].GET({
          query: {
            limit: KNOWLEDGE_BASES_MAX_LIMIT + 1
          } as never
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(listKnowledgeBasesMock).not.toHaveBeenCalled()
    })

    it('should parse and delegate POST to knowledgeBaseService.create', async () => {
      const body = {
        name: '  Knowledge Base  ',
        dimensions: 1536,
        embeddingModelId: '  text-embedding-3-large  '
      }
      createKnowledgeBaseMock.mockResolvedValueOnce({
        id: 'kb-1',
        name: 'Knowledge Base',
        dimensions: 1536,
        embeddingModelId: 'text-embedding-3-large'
      })

      const result = await knowledgeHandlers['/knowledge-bases'].POST({ body })

      expect(createKnowledgeBaseMock).toHaveBeenCalledWith({
        name: 'Knowledge Base',
        dimensions: 1536,
        embeddingModelId: 'text-embedding-3-large'
      })
      expect(result).toMatchObject({ id: 'kb-1' })
    })

    it('should reject invalid POST bodies before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases'].POST({
          body: {
            name: '   ',
            dimensions: 1536,
            embeddingModelId: 'model-1'
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createKnowledgeBaseMock).not.toHaveBeenCalled()
    })

    it('should reject blank embedding model ids before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases'].POST({
          body: {
            name: 'Knowledge Base',
            dimensions: 1536,
            embeddingModelId: '   '
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createKnowledgeBaseMock).not.toHaveBeenCalled()
    })
  })

  describe('/knowledge-bases/:id', () => {
    it('should delegate GET/PATCH/DELETE with the path id', async () => {
      getKnowledgeBaseByIdMock.mockResolvedValueOnce({ id: 'kb-1' })
      updateKnowledgeBaseMock.mockResolvedValueOnce({ id: 'kb-1', name: 'Updated Base' })
      deleteKnowledgeBaseMock.mockResolvedValueOnce(undefined)

      await expect(knowledgeHandlers['/knowledge-bases/:id'].GET({ params: { id: 'kb-1' } })).resolves.toEqual({
        id: 'kb-1'
      })

      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: { name: '  Updated Base  ' }
        })
      ).resolves.toEqual({
        id: 'kb-1',
        name: 'Updated Base'
      })

      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].DELETE({
          params: { id: 'kb-1' }
        })
      ).resolves.toBeUndefined()

      expect(getKnowledgeBaseByIdMock).toHaveBeenCalledWith('kb-1')
      expect(updateKnowledgeBaseMock).toHaveBeenCalledWith('kb-1', { name: 'Updated Base' })
      expect(deleteKnowledgeBaseMock).toHaveBeenCalledWith('kb-1')
    })

    it('should reject invalid PATCH bodies before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            dimensions: 3072
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateKnowledgeBaseMock).not.toHaveBeenCalled()
    })

    it('should reject blank names in PATCH bodies before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            name: '   '
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateKnowledgeBaseMock).not.toHaveBeenCalled()
    })

    it('should reject embeddingModelId updates before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            embeddingModelId: 'new-model'
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateKnowledgeBaseMock).not.toHaveBeenCalled()
    })
  })

  describe('/knowledge-bases/:id/root/children', () => {
    it('should apply default pagination when query is missing', async () => {
      listKnowledgeRootChildrenMock.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: KNOWLEDGE_ITEMS_DEFAULT_PAGE
      })

      await knowledgeHandlers['/knowledge-bases/:id/root/children'].GET({
        params: { id: 'kb-1' }
      })

      expect(listKnowledgeRootChildrenMock).toHaveBeenCalledWith('kb-1', {
        page: KNOWLEDGE_ITEMS_DEFAULT_PAGE,
        limit: KNOWLEDGE_ITEMS_DEFAULT_LIMIT,
        type: undefined
      })
    })

    it('should pass type filter to root children listing', async () => {
      listKnowledgeRootChildrenMock.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 2
      })

      await knowledgeHandlers['/knowledge-bases/:id/root/children'].GET({
        params: { id: 'kb-1' },
        query: {
          page: 2,
          limit: 10,
          type: 'directory'
        } as never
      } as never)

      expect(listKnowledgeRootChildrenMock).toHaveBeenCalledWith('kb-1', {
        page: 2,
        limit: 10,
        type: 'directory'
      })
    })

    it('should reject non-positive page values', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/root/children'].GET({
          params: { id: 'kb-1' },
          query: {
            page: 0
          } as never
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(listKnowledgeRootChildrenMock).not.toHaveBeenCalled()
    })

    it('should reject limit values above the max limit', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/root/children'].GET({
          params: { id: 'kb-1' },
          query: {
            limit: KNOWLEDGE_ITEMS_MAX_LIMIT + 1
          } as never
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(listKnowledgeRootChildrenMock).not.toHaveBeenCalled()
    })

    it('should reject invalid type filters', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/root/children'].GET({
          params: { id: 'kb-1' },
          query: {
            type: 'memory'
          } as never
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(listKnowledgeRootChildrenMock).not.toHaveBeenCalled()
    })

    it('should delegate POST to knowledgeItemService.createRootChildren', async () => {
      const body: CreateKnowledgeRootChildrenDto = {
        items: [
          {
            type: 'note',
            data: { content: 'hello world' }
          }
        ]
      }
      createKnowledgeRootChildrenMock.mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            baseId: 'kb-1',
            parentId: null,
            type: 'note',
            data: { content: 'hello world' }
          }
        ]
      })

      const result = await knowledgeHandlers['/knowledge-bases/:id/root/children'].POST({
        params: { id: 'kb-1' },
        body
      })

      expect(createKnowledgeRootChildrenMock).toHaveBeenCalledWith('kb-1', {
        items: [
          {
            type: 'note',
            data: { content: 'hello world' }
          }
        ]
      })
      expect(result).toMatchObject({
        items: [
          {
            id: 'item-1'
          }
        ]
      })
    })

    it('should reject invalid POST bodies before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/root/children'].POST({
          params: { id: 'kb-1' },
          body: {
            items: []
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createKnowledgeRootChildrenMock).not.toHaveBeenCalled()
    })

    it('should reject parentId in root-only create requests', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/root/children'].POST({
          params: { id: 'kb-1' },
          body: {
            items: [
              {
                parentId: '550e8400-e29b-41d4-a716-446655440001',
                type: 'note',
                data: { content: 'hello world' }
              }
            ]
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createKnowledgeRootChildrenMock).not.toHaveBeenCalled()
    })
  })

  describe('/knowledge-items/:id/children', () => {
    it('should apply default pagination when query is missing', async () => {
      listKnowledgeItemChildrenMock.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: KNOWLEDGE_ITEMS_DEFAULT_PAGE
      })

      await knowledgeHandlers['/knowledge-items/:id/children'].GET({
        params: { id: 'item-1' }
      })

      expect(listKnowledgeItemChildrenMock).toHaveBeenCalledWith('item-1', {
        page: KNOWLEDGE_ITEMS_DEFAULT_PAGE,
        limit: KNOWLEDGE_ITEMS_DEFAULT_LIMIT
      })
    })

    it('should delegate explicit pagination to knowledgeItemService.listChildren', async () => {
      listKnowledgeItemChildrenMock.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 2
      })

      await knowledgeHandlers['/knowledge-items/:id/children'].GET({
        params: { id: 'item-1' },
        query: {
          page: 2,
          limit: 10
        } as never
      } as never)

      expect(listKnowledgeItemChildrenMock).toHaveBeenCalledWith('item-1', {
        page: 2,
        limit: 10
      })
    })

    it('should bubble NotFound when the parent item does not exist', async () => {
      listKnowledgeItemChildrenMock.mockRejectedValueOnce({
        code: 'NOT_FOUND',
        status: 404
      })

      await expect(
        knowledgeHandlers['/knowledge-items/:id/children'].GET({
          params: { id: 'missing-item' }
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404
      })
    })
  })

  describe('/knowledge-items/:id', () => {
    it('should delegate GET/PATCH/DELETE with the item id', async () => {
      getKnowledgeItemByIdMock.mockResolvedValueOnce({ id: 'item-1' })
      updateKnowledgeItemMock.mockResolvedValueOnce({ id: 'item-1', status: 'completed' })
      deleteKnowledgeItemMock.mockResolvedValueOnce(undefined)

      await expect(knowledgeHandlers['/knowledge-items/:id'].GET({ params: { id: 'item-1' } })).resolves.toEqual({
        id: 'item-1'
      })

      await expect(
        knowledgeHandlers['/knowledge-items/:id'].PATCH({
          params: { id: 'item-1' },
          body: { status: 'completed' }
        })
      ).resolves.toEqual({
        id: 'item-1',
        status: 'completed'
      })

      await expect(
        knowledgeHandlers['/knowledge-items/:id'].DELETE({
          params: { id: 'item-1' }
        })
      ).resolves.toBeUndefined()

      expect(getKnowledgeItemByIdMock).toHaveBeenCalledWith('item-1')
      expect(updateKnowledgeItemMock).toHaveBeenCalledWith('item-1', { status: 'completed' })
      expect(deleteKnowledgeItemMock).toHaveBeenCalledWith('item-1')
    })

    it('should reject invalid PATCH bodies before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-items/:id'].PATCH({
          params: { id: 'item-1' },
          body: {
            status: 'unknown'
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateKnowledgeItemMock).not.toHaveBeenCalled()
    })
  })
})
