import { dbService } from '@data/db/DbService'
import { ErrorCode } from '@shared/data/api/apiErrors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { knowledgeItemService } from './KnowledgeItemService'

vi.mock('@data/db/DbService', () => ({
  dbService: {
    getDb: vi.fn()
  }
}))

vi.mock('./KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    getById: vi.fn().mockResolvedValue({ id: 'kb-1' })
  }
}))

const createItemRow = () => ({
  id: 'item-1',
  baseId: 'kb-1',
  parentId: null,
  type: 'url',
  data: { url: 'https://example.com', name: 'example' },
  status: 'idle',
  error: null,
  createdAt: Date.now(),
  updatedAt: Date.now()
})

describe('KnowledgeItemService validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('create rejects invalid item type before DB write', async () => {
    const insert = vi.fn()
    const getDbMock = dbService.getDb as unknown as ReturnType<typeof vi.fn>
    getDbMock.mockReturnValue({ insert } as any)

    await expect(
      knowledgeItemService.create('kb-1', {
        items: [{ type: 'video' as any, data: { url: 'https://example.com', name: 'example' } as any }]
      })
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 422
    })

    expect(insert).not.toHaveBeenCalled()
  })

  it('update rejects empty payload before DB write', async () => {
    const row = createItemRow()
    const update = vi.fn()
    const getDbMock = dbService.getDb as unknown as ReturnType<typeof vi.fn>
    getDbMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      }),
      update
    } as any)

    await expect(knowledgeItemService.update('item-1', {})).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 422
    })

    expect(update).not.toHaveBeenCalled()
  })

  it('update rejects invalid status before DB write', async () => {
    const row = createItemRow()
    const update = vi.fn()
    const getDbMock = dbService.getDb as unknown as ReturnType<typeof vi.fn>
    getDbMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      }),
      update
    } as any)

    await expect(
      knowledgeItemService.update('item-1', {
        status: 'invalid-status' as any
      })
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 422
    })

    expect(update).not.toHaveBeenCalled()
  })
})
