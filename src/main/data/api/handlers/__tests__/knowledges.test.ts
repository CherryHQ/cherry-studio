import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listKnowledgeBasesMock,
  getKnowledgeBaseByIdMock,
  updateKnowledgeBaseMock,
  deleteKnowledgeBaseMock,
  listKnowledgeItemsMock,
  getKnowledgeItemByIdMock
} = vi.hoisted(() => ({
  listKnowledgeBasesMock: vi.fn(),
  getKnowledgeBaseByIdMock: vi.fn(),
  updateKnowledgeBaseMock: vi.fn(),
  deleteKnowledgeBaseMock: vi.fn(),
  listKnowledgeItemsMock: vi.fn(),
  getKnowledgeItemByIdMock: vi.fn()
}))

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    list: listKnowledgeBasesMock,
    getById: getKnowledgeBaseByIdMock,
    update: updateKnowledgeBaseMock,
    delete: deleteKnowledgeBaseMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    list: listKnowledgeItemsMock,
    getById: getKnowledgeItemByIdMock
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
  })

  describe('/knowledge-bases/:id', () => {
    it('should delegate GET/PATCH with the path id', async () => {
      getKnowledgeBaseByIdMock.mockResolvedValueOnce({ id: 'kb-1' })
      updateKnowledgeBaseMock.mockResolvedValueOnce({ id: 'kb-1', name: 'Updated Base' })

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

      expect(getKnowledgeBaseByIdMock).toHaveBeenCalledWith('kb-1')
      expect(updateKnowledgeBaseMock).toHaveBeenCalledWith('kb-1', { name: 'Updated Base' })
      expect(deleteKnowledgeBaseMock).not.toHaveBeenCalled()
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
            embeddingModelId: '  new-model  '
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateKnowledgeBaseMock).not.toHaveBeenCalled()
    })

    it('should trim groupId and keep emoji unchanged in PATCH bodies before calling the service', async () => {
      updateKnowledgeBaseMock.mockResolvedValueOnce({ id: 'kb-1', groupId: 'group-1', emoji: '📚' })

      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            groupId: '  group-1  ',
            emoji: '📚'
          }
        })
      ).resolves.toMatchObject({ id: 'kb-1' })

      expect(updateKnowledgeBaseMock).toHaveBeenCalledWith('kb-1', {
        groupId: 'group-1',
        emoji: '📚'
      })
    })

    it('should reject null embeddingModelId clears before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            embeddingModelId: null
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateKnowledgeBaseMock).not.toHaveBeenCalled()
    })

    it('should reject optional config null clears before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            rerankModelId: null,
            fileProcessorId: null,
            threshold: null,
            documentCount: null,
            hybridAlpha: null
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateKnowledgeBaseMock).not.toHaveBeenCalled()
    })

    it('should reject invalid emoji in PATCH bodies before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            emoji: 'books'
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateKnowledgeBaseMock).not.toHaveBeenCalled()
    })

    it('should reject whitespace-padded emoji in PATCH bodies before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            emoji: '  📚  '
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateKnowledgeBaseMock).not.toHaveBeenCalled()
    })

    it('should pass null groupId clears before calling the service', async () => {
      updateKnowledgeBaseMock.mockResolvedValueOnce({ id: 'kb-1', groupId: null })

      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            groupId: null
          }
        })
      ).resolves.toMatchObject({ id: 'kb-1', groupId: null })

      expect(updateKnowledgeBaseMock).toHaveBeenCalledWith('kb-1', {
        groupId: null
      })
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
        limit: KNOWLEDGE_ITEMS_DEFAULT_LIMIT
      })
    })

    it('should pass type/group filters to knowledge item listing', async () => {
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
          type: 'directory',
          groupId: 'group-1'
        } as never
      } as never)

      expect(listKnowledgeItemsMock).toHaveBeenCalledWith('kb-1', {
        page: 2,
        limit: 10,
        type: 'directory',
        groupId: 'group-1'
      })
    })

    it('should pass null groupId root filters to knowledge item listing', async () => {
      listKnowledgeItemsMock.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1
      })

      await knowledgeHandlers['/knowledge-bases/:id/items'].GET({
        params: { id: 'kb-1' },
        query: {
          groupId: null
        }
      } as never)

      expect(listKnowledgeItemsMock).toHaveBeenCalledWith('kb-1', {
        page: KNOWLEDGE_ITEMS_DEFAULT_PAGE,
        limit: KNOWLEDGE_ITEMS_DEFAULT_LIMIT,
        groupId: null
      })
    })

    it('should reject non-positive page values', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/items'].GET({
          params: { id: 'kb-1' },
          query: {
            page: 0
          } as never
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(listKnowledgeItemsMock).not.toHaveBeenCalled()
    })

    it('should reject limit values above the max limit', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/items'].GET({
          params: { id: 'kb-1' },
          query: {
            limit: KNOWLEDGE_ITEMS_MAX_LIMIT + 1
          } as never
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(listKnowledgeItemsMock).not.toHaveBeenCalled()
    })

    it('should reject invalid type filters', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/items'].GET({
          params: { id: 'kb-1' },
          query: {
            type: 'memory'
          } as never
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(listKnowledgeItemsMock).not.toHaveBeenCalled()
    })
  })

  describe('/knowledge-items/:id', () => {
    it('should delegate GET with the item id', async () => {
      getKnowledgeItemByIdMock.mockResolvedValueOnce({ id: 'item-1' })

      await expect(knowledgeHandlers['/knowledge-items/:id'].GET({ params: { id: 'item-1' } })).resolves.toEqual({
        id: 'item-1'
      })

      expect(getKnowledgeItemByIdMock).toHaveBeenCalledWith('item-1')
    })
  })
})
