import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/db/DbService', () => ({
  dbService: {
    getDb: vi.fn()
  }
}))

vi.mock('./KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    getById: vi.fn()
  }
}))

import { dbService } from '@data/db/DbService'

import { knowledgeBaseService } from './KnowledgeBaseService'
import { KnowledgeItemService } from './KnowledgeItemService'

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

describe('KnowledgeItemService.list', () => {
  const getDbMock = vi.mocked(dbService.getDb)
  const getKnowledgeBaseByIdMock = vi.mocked(knowledgeBaseService.getById)
  const service = KnowledgeItemService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
    getKnowledgeBaseByIdMock.mockResolvedValue({ id: 'kb-1' } as never)
  })

  it('returns root-level items by default', async () => {
    const orderByMock = vi.fn().mockResolvedValue([buildRow()])
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock })
    const fromMock = vi.fn().mockReturnValue({ where: whereMock })
    const selectMock = vi.fn().mockReturnValue({ from: fromMock })

    getDbMock.mockReturnValue({
      select: selectMock
    } as never)

    const result = await service.list('kb-1')

    expect(result).toEqual([
      expect.objectContaining({
        id: 'item-1',
        baseId: 'kb-1',
        parentId: null,
        type: 'note',
        data: {
          content: 'hello'
        }
      })
    ])
  })

  it('returns direct children when parentId is provided', async () => {
    const orderByMock = vi.fn().mockResolvedValue([
      buildRow({
        id: 'child-1',
        parentId: 'folder-1',
        data: { content: 'child' }
      })
    ])
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock })
    const fromMock = vi.fn().mockReturnValue({ where: whereMock })
    const selectMock = vi.fn().mockReturnValue({ from: fromMock })

    getDbMock.mockReturnValue({
      select: selectMock
    } as never)

    const result = await service.list('kb-1', 'folder-1')

    expect(result).toEqual([
      expect.objectContaining({
        id: 'child-1',
        baseId: 'kb-1',
        parentId: 'folder-1',
        type: 'note',
        data: {
          content: 'child'
        }
      })
    ])
  })
})
