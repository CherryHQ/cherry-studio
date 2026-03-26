import type { CreateKnowledgeItemsDto } from '@shared/data/api/schemas/knowledges'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listKnowledgeBasesMock,
  createKnowledgeBaseMock,
  getKnowledgeBaseByIdMock,
  updateKnowledgeBaseMock,
  deleteKnowledgeBaseMock,
  listKnowledgeItemsMock,
  createKnowledgeItemsMock,
  getKnowledgeItemByIdMock,
  updateKnowledgeItemMock,
  deleteKnowledgeItemMock
} = vi.hoisted(() => ({
  listKnowledgeBasesMock: vi.fn(),
  createKnowledgeBaseMock: vi.fn(),
  getKnowledgeBaseByIdMock: vi.fn(),
  updateKnowledgeBaseMock: vi.fn(),
  deleteKnowledgeBaseMock: vi.fn(),
  listKnowledgeItemsMock: vi.fn(),
  createKnowledgeItemsMock: vi.fn(),
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
    list: listKnowledgeItemsMock,
    create: createKnowledgeItemsMock,
    getById: getKnowledgeItemByIdMock,
    update: updateKnowledgeItemMock,
    delete: deleteKnowledgeItemMock
  }
}))

import { KNOWLEDGE_ITEMS_DEFAULT_LIMIT, KNOWLEDGE_ITEMS_DEFAULT_PAGE } from '@shared/data/api/schemas/knowledges'

import { knowledgeHandlers } from '../knowledges'

describe('knowledgeHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/knowledge-bases', () => {
    it('should delegate GET to knowledgeBaseService.list', async () => {
      const response = [{ id: 'kb-1', name: 'Knowledge Base' }]
      listKnowledgeBasesMock.mockResolvedValueOnce(response)

      const result = await knowledgeHandlers['/knowledge-bases'].GET({})

      expect(listKnowledgeBasesMock).toHaveBeenCalledWith()
      expect(result).toEqual(response)
    })

    it('should delegate POST to knowledgeBaseService.create', async () => {
      const body = {
        name: 'Knowledge Base',
        dimensions: 1536,
        embeddingModelId: 'text-embedding-3-large'
      }
      createKnowledgeBaseMock.mockResolvedValueOnce({ id: 'kb-1', ...body })

      const result = await knowledgeHandlers['/knowledge-bases'].POST({ body })

      expect(createKnowledgeBaseMock).toHaveBeenCalledWith(body)
      expect(result).toMatchObject({ id: 'kb-1' })
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
          body: { name: 'Updated Base' }
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
  })

  describe('/knowledge-bases/:id/items', () => {
    it('should apply default pagination when query is missing', async () => {
      listKnowledgeItemsMock.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: KNOWLEDGE_ITEMS_DEFAULT_PAGE
      })

      await knowledgeHandlers['/knowledge-bases/:id/items'].GET({
        params: { id: 'kb-1' }
      })

      expect(listKnowledgeItemsMock).toHaveBeenCalledWith('kb-1', {
        page: KNOWLEDGE_ITEMS_DEFAULT_PAGE,
        limit: KNOWLEDGE_ITEMS_DEFAULT_LIMIT,
        parentId: undefined
      })
    })

    it('should trim parentId before delegating to the service', async () => {
      listKnowledgeItemsMock.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 2
      })

      await knowledgeHandlers['/knowledge-bases/:id/items'].GET({
        params: { id: 'kb-1' },
        query: {
          page: 2,
          limit: 10,
          parentId: '  parent-1  '
        } as never
      } as never)

      expect(listKnowledgeItemsMock).toHaveBeenCalledWith('kb-1', {
        page: 2,
        limit: 10,
        parentId: 'parent-1'
      })
    })

    it('should normalize blank parentId to undefined', async () => {
      listKnowledgeItemsMock.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1
      })

      await knowledgeHandlers['/knowledge-bases/:id/items'].GET({
        params: { id: 'kb-1' },
        query: {
          parentId: '   '
        } as never
      } as never)

      expect(listKnowledgeItemsMock).toHaveBeenCalledWith('kb-1', {
        page: KNOWLEDGE_ITEMS_DEFAULT_PAGE,
        limit: KNOWLEDGE_ITEMS_DEFAULT_LIMIT,
        parentId: undefined
      })
    })

    it('should delegate POST to knowledgeItemService.create', async () => {
      const body: CreateKnowledgeItemsDto = {
        items: [{ type: 'note', data: { content: 'hello world' } }]
      }
      createKnowledgeItemsMock.mockResolvedValueOnce({
        items: [{ id: 'item-1', baseId: 'kb-1', type: 'note', data: { content: 'hello world' } }]
      })

      const result = await knowledgeHandlers['/knowledge-bases/:id/items'].POST({
        params: { id: 'kb-1' },
        body
      })

      expect(createKnowledgeItemsMock).toHaveBeenCalledWith('kb-1', body)
      expect(result).toMatchObject({
        items: [
          {
            id: 'item-1'
          }
        ]
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
  })
})
