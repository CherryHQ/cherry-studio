import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

const { createKnowledgeBaseMock, updateKnowledgeBaseMock, createKnowledgeItemsMock, listKnowledgeItemsMock } =
  vi.hoisted(() => ({
    createKnowledgeBaseMock: vi.fn(),
    updateKnowledgeBaseMock: vi.fn(),
    createKnowledgeItemsMock: vi.fn(),
    listKnowledgeItemsMock: vi.fn()
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
    list: listKnowledgeItemsMock,
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

    it('accepts nulls for clearable update fields', async () => {
      updateKnowledgeBaseMock.mockResolvedValueOnce({ id: 'kb-1' } as never)

      await knowledgeHandlers['/knowledge-bases/:id'].PATCH({
        params: { id: 'kb-1' },
        body: {
          description: null,
          rerankModelId: null,
          fileProcessorId: null,
          chunkSize: null,
          chunkOverlap: null,
          threshold: null,
          documentCount: null,
          searchMode: 'default',
          hybridAlpha: null
        } as never
      })

      expect(updateKnowledgeBaseMock).toHaveBeenCalledWith('kb-1', {
        description: null,
        rerankModelId: null,
        fileProcessorId: null,
        chunkSize: null,
        chunkOverlap: null,
        threshold: null,
        documentCount: null,
        searchMode: 'default',
        hybridAlpha: null
      })
    })
  })

  describe('POST /knowledge-bases/:id/items', () => {
    it('should trim parentId before passing it to the service', async () => {
      listKnowledgeItemsMock.mockResolvedValueOnce([])

      const result = await knowledgeHandlers['/knowledge-bases/:id/items'].GET({
        params: { id: 'kb-1' },
        query: { parentId: '  dir-1  ' } as never
      })

      expect(listKnowledgeItemsMock).toHaveBeenCalledWith('kb-1', 'dir-1')
      expect(result).toEqual([])
    })

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

    it('should throw a ZodError when create item body contains internal directory entry payloads', async () => {
      await expect(
        knowledgeHandlers['/knowledge-bases/:id/items'].POST({
          params: { id: 'kb-1' },
          body: {
            items: [
              {
                type: 'directory',
                data: {
                  kind: 'entry',
                  groupId: 'group-1',
                  groupName: 'Docs',
                  file: {
                    id: 'file-1',
                    name: 'report.pdf',
                    origin_name: 'report.pdf',
                    path: '/tmp/report.pdf',
                    size: 123,
                    ext: '.pdf',
                    type: 'document',
                    created_at: '2026-03-24T00:00:00.000Z',
                    count: 1
                  }
                }
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

  describe('PATCH /knowledge-items/:id', () => {
    it('should throw a ZodError when update item body contains internal directory entry payloads', async () => {
      await expect(
        knowledgeHandlers['/knowledge-items/:id'].PATCH({
          params: { id: 'item-1' },
          body: {
            data: {
              kind: 'entry',
              groupId: 'group-1',
              groupName: 'Docs',
              file: {
                id: 'file-1',
                name: 'report.pdf',
                origin_name: 'report.pdf',
                path: '/tmp/report.pdf',
                size: 123,
                ext: '.pdf',
                type: 'document',
                created_at: '2026-03-24T00:00:00.000Z',
                count: 1
              }
            }
          } as never
        })
      ).rejects.toBeInstanceOf(ZodError)
    })
  })
})
