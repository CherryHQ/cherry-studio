import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

const { createKnowledgeItemsMock } = vi.hoisted(() => ({
  createKnowledgeItemsMock: vi.fn()
}))

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    list: vi.fn(),
    create: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
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
