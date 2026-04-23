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
    createMany: createKnowledgeItemsMock,
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
        embeddingModelId: '  text-embedding-3-large  ',
        groupId: '  group-1  ',
        emoji: '📚'
      }
      createKnowledgeBaseMock.mockResolvedValueOnce({
        id: 'kb-1',
        name: 'Knowledge Base',
        dimensions: 1536,
        embeddingModelId: 'text-embedding-3-large',
        groupId: 'group-1',
        emoji: '📚'
      })

      const result = await knowledgeHandlers['/knowledge-bases'].POST({ body })

      expect(createKnowledgeBaseMock).toHaveBeenCalledWith({
        name: 'Knowledge Base',
        dimensions: 1536,
        embeddingModelId: 'text-embedding-3-large',
        groupId: '  group-1  ',
        emoji: '📚',
        searchMode: 'hybrid'
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

    it('should reject invalid emoji in POST bodies before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases'].POST({
          body: {
            name: 'Knowledge Base',
            dimensions: 1536,
            embeddingModelId: 'model-1',
            emoji: 'books'
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createKnowledgeBaseMock).not.toHaveBeenCalled()
    })

    it('should reject whitespace-padded emoji in POST bodies before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases'].POST({
          body: {
            name: 'Knowledge Base',
            dimensions: 1536,
            embeddingModelId: 'model-1',
            emoji: '  📚  '
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createKnowledgeBaseMock).not.toHaveBeenCalled()
    })

    it('should reject POST bodies that provide chunkOverlap without chunkSize', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases'].POST({
          body: {
            name: 'Knowledge Base',
            dimensions: 1536,
            embeddingModelId: 'model-1',
            chunkOverlap: 64
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

    it('should allow embeddingModelId updates and normalize them before calling the service', async () => {
      updateKnowledgeBaseMock.mockResolvedValueOnce({ id: 'kb-1', embeddingModelId: 'new-model' })

      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            embeddingModelId: '  new-model  '
          }
        })
      ).resolves.toMatchObject({ id: 'kb-1' })

      expect(updateKnowledgeBaseMock).toHaveBeenCalledWith('kb-1', { embeddingModelId: 'new-model' })
    })

    it('should pass through groupId and keep emoji unchanged in PATCH bodies before calling the service', async () => {
      updateKnowledgeBaseMock.mockResolvedValueOnce({ id: 'kb-1', groupId: '  group-1  ', emoji: '📚' })

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
        groupId: '  group-1  ',
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

    it('should reject null groupId clears before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            groupId: null
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateKnowledgeBaseMock).not.toHaveBeenCalled()
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

    it('should delegate POST to knowledgeItemService.createMany', async () => {
      const body: CreateKnowledgeItemsDto = {
        items: [
          {
            groupId: 'group-1',
            type: 'note',
            data: { content: 'hello world' }
          }
        ]
      }
      createKnowledgeItemsMock.mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            baseId: 'kb-1',
            groupId: 'group-1',
            type: 'note',
            data: { content: 'hello world' }
          }
        ]
      })

      const result = await knowledgeHandlers['/knowledge-bases/:id/items'].POST({
        params: { id: 'kb-1' },
        body
      })

      expect(createKnowledgeItemsMock).toHaveBeenCalledWith('kb-1', {
        items: [
          {
            groupId: 'group-1',
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

    it('should accept sitemap owner items with grouped url children', async () => {
      const body: CreateKnowledgeItemsDto = {
        items: [
          {
            ref: 'sitemap-root',
            type: 'sitemap',
            data: {
              url: 'https://example.com/sitemap.xml',
              name: 'Example Sitemap'
            }
          },
          {
            groupRef: 'sitemap-root',
            type: 'url',
            data: {
              url: 'https://example.com/page-a',
              name: 'Page A'
            }
          }
        ]
      }

      createKnowledgeItemsMock.mockResolvedValueOnce({
        items: [
          {
            id: 'sitemap-1',
            baseId: 'kb-1',
            groupId: null,
            type: 'sitemap',
            data: {
              url: 'https://example.com/sitemap.xml',
              name: 'Example Sitemap'
            }
          },
          {
            id: 'url-1',
            baseId: 'kb-1',
            groupId: 'sitemap-1',
            type: 'url',
            data: {
              url: 'https://example.com/page-a',
              name: 'Page A'
            }
          }
        ]
      })

      const result = await knowledgeHandlers['/knowledge-bases/:id/items'].POST({
        params: { id: 'kb-1' },
        body
      })

      expect(createKnowledgeItemsMock).toHaveBeenCalledWith('kb-1', body)
      expect(result).toMatchObject({
        items: [
          { id: 'sitemap-1', type: 'sitemap' },
          { id: 'url-1', type: 'url' }
        ]
      })
    })

    it('should reject invalid POST bodies before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/items'].POST({
          params: { id: 'kb-1' },
          body: {
            items: []
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createKnowledgeItemsMock).not.toHaveBeenCalled()
    })

    it('should reject parentId in flat item create requests', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/items'].POST({
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

      expect(createKnowledgeItemsMock).not.toHaveBeenCalled()
    })

    it('should reject POST bodies that specify both groupId and groupRef', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/items'].POST({
          params: { id: 'kb-1' },
          body: {
            items: [
              {
                groupId: 'group-1',
                groupRef: 'root',
                type: 'note',
                data: { content: 'hello world' }
              }
            ]
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createKnowledgeItemsMock).not.toHaveBeenCalled()
    })

    it('should reject POST bodies with duplicate refs', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/items'].POST({
          params: { id: 'kb-1' },
          body: {
            items: [
              {
                ref: 'duplicate',
                type: 'directory',
                data: { name: 'files', path: '/tmp/files' }
              },
              {
                ref: 'duplicate',
                type: 'note',
                data: { content: 'hello world' }
              }
            ]
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createKnowledgeItemsMock).not.toHaveBeenCalled()
    })

    it('should reject POST bodies with missing groupRef targets', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/items'].POST({
          params: { id: 'kb-1' },
          body: {
            items: [
              {
                groupRef: 'missing-root',
                type: 'url',
                data: {
                  url: 'https://example.com/page-a',
                  name: 'Page A'
                }
              }
            ]
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createKnowledgeItemsMock).not.toHaveBeenCalled()
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

    it('should reject groupId in PATCH bodies before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-items/:id'].PATCH({
          params: { id: 'item-1' },
          body: {
            groupId: 'group-1'
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateKnowledgeItemMock).not.toHaveBeenCalled()
    })
  })
})
