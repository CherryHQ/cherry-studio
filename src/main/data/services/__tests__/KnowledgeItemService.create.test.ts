import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/db/DbService', () => ({
  dbService: {
    getDb: vi.fn()
  }
}))

vi.mock('../KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    getById: vi.fn()
  }
}))

import { dbService } from '@data/db/DbService'

import { knowledgeBaseService } from '../KnowledgeBaseService'
import { KnowledgeItemService } from '../KnowledgeItemService'

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  baseId: 'kb-1',
  parentId: null,
  type: 'note' as const,
  data: {
    content: 'hello'
  },
  status: 'idle' as const,
  error: null,
  createdAt: 1710000000000,
  updatedAt: 1710000000000,
  ...overrides
})

describe('KnowledgeItemService.create', () => {
  const getDbMock = vi.mocked(dbService.getDb)
  const getKnowledgeBaseByIdMock = vi.mocked(knowledgeBaseService.getById)
  const service = KnowledgeItemService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
    getKnowledgeBaseByIdMock.mockResolvedValue({ id: 'kb-1' } as never)
  })

  it('creates root-level items and persists parentId as null', async () => {
    const returningMock = vi.fn().mockResolvedValue([buildRow()])
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock })
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock })

    getDbMock.mockReturnValue({
      insert: insertMock
    } as never)

    const result = await service.create('kb-1', {
      items: [
        {
          type: 'note',
          data: { content: 'hello' }
        }
      ]
    })

    expect(valuesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        baseId: 'kb-1',
        parentId: null,
        type: 'note',
        data: { content: 'hello' },
        status: 'idle',
        error: null
      })
    ])
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'item-1',
        baseId: 'kb-1',
        parentId: null,
        type: 'note',
        data: { content: 'hello' }
      })
    ])
  })
})
