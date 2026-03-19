import { beforeEach, describe, expect, it, vi } from 'vitest'

import { knowledgeHandlers } from './knowledges'

const baseServiceMock = {
  list: vi.fn(),
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn()
}

const itemServiceMock = {
  list: vi.fn(),
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn()
}

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: baseServiceMock
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: itemServiceMock
}))

describe('knowledgeHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET /knowledge-bases calls knowledgeBaseService.list', async () => {
    baseServiceMock.list.mockResolvedValue([{ id: 'kb-1' }])

    const result = await knowledgeHandlers['/knowledge-bases'].GET({} as any)

    expect(baseServiceMock.list).toHaveBeenCalledTimes(1)
    expect(result).toEqual([{ id: 'kb-1' }])
  })

  it('PATCH /knowledge-bases/:id forwards params and body', async () => {
    baseServiceMock.update.mockResolvedValue({ id: 'kb-1', name: 'updated' })

    const result = await knowledgeHandlers['/knowledge-bases/:id'].PATCH({
      params: { id: 'kb-1' },
      body: { name: 'updated' }
    } as any)

    expect(baseServiceMock.update).toHaveBeenCalledWith('kb-1', { name: 'updated' })
    expect(result).toEqual({ id: 'kb-1', name: 'updated' })
  })

  it('DELETE /knowledge-items/:id calls service and returns undefined', async () => {
    itemServiceMock.delete.mockResolvedValue(undefined)

    const result = await knowledgeHandlers['/knowledge-items/:id'].DELETE({
      params: { id: 'item-1' }
    } as any)

    expect(itemServiceMock.delete).toHaveBeenCalledWith('item-1')
    expect(result).toBeUndefined()
  })
})
