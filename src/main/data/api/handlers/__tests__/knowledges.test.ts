import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

const { createKnowledgeBaseMock, updateKnowledgeBaseMock, createKnowledgeItemsMock } = vi.hoisted(() => ({
  createKnowledgeBaseMock: vi.fn(),
  updateKnowledgeBaseMock: vi.fn(),
  createKnowledgeItemsMock: vi.fn()
}))

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    list: vi.fn(),
    create: createKnowledgeBaseMock,
    getById: vi.fn(),
    update: updateKnowledgeBaseMock,
    delete: vi.fn()
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    list: vi.fn(),
    create: createKnowledgeItemsMock,
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
}))

import { knowledgeHandlers } from '../knowledges'

describe('knowledgeHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('knowledge base validation', () => {
    it('rejects invalid create payloads before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases'].POST({
          body: {
            name: 'Knowledge Base',
            dimensions: 0,
            embeddingModelId: 'provider::model',
            chunkSize: 80,
            chunkOverlap: 120,
            threshold: 1.2,
            documentCount: 0,
            searchMode: 'default',
            hybridAlpha: 0.5
          } as never
        })
      ).rejects.toBeInstanceOf(ZodError)

      expect(createKnowledgeBaseMock).not.toHaveBeenCalled()
    })

    it('rejects invalid update payloads before calling the service', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id'].PATCH({
          params: { id: 'kb-1' },
          body: {
            chunkSize: 300,
            chunkOverlap: 300,
            searchMode: 'bm25',
            hybridAlpha: 0.5
          } as never
        })
      ).rejects.toBeInstanceOf(ZodError)

      expect(updateKnowledgeBaseMock).not.toHaveBeenCalled()
    })
  })

  describe('POST /knowledge-bases/:id/items', () => {
    it('should throw a ZodError when create item body contains unknown fields', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/items'].POST({
          params: { id: 'kb-1' },
          body: {
            items: [
              {
                type: 'note',
                data: { content: 'child note' },
                parentId: 'folder-1'
              }
            ]
          } as never
        })
      ).rejects.toBeInstanceOf(ZodError)

      expect(createKnowledgeItemsMock).not.toHaveBeenCalled()
    })

    it('should pass validated body to the service', async () => {
      const createdItems = {
        items: [
          {
            id: 'item-1',
            baseId: 'kb-1',
            parentId: null,
            type: 'note' as const,
            data: { content: 'hello' },
            status: 'idle' as const,
            createdAt: '2026-03-24T00:00:00.000Z',
            updatedAt: '2026-03-24T00:00:00.000Z'
          }
        ]
      }
      createKnowledgeItemsMock.mockResolvedValueOnce(createdItems)

      const result = await knowledgeHandlers['/knowledge-bases/:id/items'].POST({
        params: { id: 'kb-1' },
        body: {
          items: [
            {
              type: 'note',
              data: { content: 'hello' }
            }
          ]
        }
      })

      expect(createKnowledgeItemsMock).toHaveBeenCalledWith('kb-1', {
        items: [
          {
            type: 'note',
            data: { content: 'hello' }
          }
        ]
      })
      expect(result).toEqual(createdItems)
    })
  })
})
