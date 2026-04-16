import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listPaintingsMock,
  createPaintingMock,
  getPaintingByIdMock,
  updatePaintingMock,
  deletePaintingMock,
  reorderPaintingsMock
} = vi.hoisted(() => ({
  listPaintingsMock: vi.fn(),
  createPaintingMock: vi.fn(),
  getPaintingByIdMock: vi.fn(),
  updatePaintingMock: vi.fn(),
  deletePaintingMock: vi.fn(),
  reorderPaintingsMock: vi.fn()
}))

vi.mock('@data/services/PaintingService', () => ({
  paintingService: {
    list: listPaintingsMock,
    create: createPaintingMock,
    getById: getPaintingByIdMock,
    update: updatePaintingMock,
    delete: deletePaintingMock,
    reorder: reorderPaintingsMock
  }
}))

import {
  PAINTINGS_DEFAULT_LIMIT,
  PAINTINGS_DEFAULT_OFFSET,
  PAINTINGS_MAX_LIMIT
} from '@shared/data/api/schemas/paintings'

import { paintingHandlers } from '../paintings'

describe('paintingHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies default list pagination when query is missing', async () => {
    listPaintingsMock.mockResolvedValueOnce({
      items: [],
      total: 0,
      limit: PAINTINGS_DEFAULT_LIMIT,
      offset: PAINTINGS_DEFAULT_OFFSET
    })

    await paintingHandlers['/paintings'].GET({})

    expect(listPaintingsMock).toHaveBeenCalledWith({
      limit: PAINTINGS_DEFAULT_LIMIT,
      offset: PAINTINGS_DEFAULT_OFFSET
    })
  })

  it('rejects invalid list query before calling the service', async () => {
    await expect(
      paintingHandlers['/paintings'].GET({
        query: {
          limit: PAINTINGS_MAX_LIMIT + 1
        } as never
      } as never)
    ).rejects.toHaveProperty('name', 'ZodError')

    expect(listPaintingsMock).not.toHaveBeenCalled()
  })

  it('parses create and reorder payloads before delegating', async () => {
    createPaintingMock.mockResolvedValueOnce({ id: 'painting-1' })
    reorderPaintingsMock.mockResolvedValueOnce({ reorderedCount: 2 })

    await paintingHandlers['/paintings'].POST({
      body: {
        providerId: '  aihubmix  ',
        mode: 'generate',
        prompt: 'hello'
      }
    } as never)

    await paintingHandlers['/paintings/reorder'].POST({
      body: {
        orderedIds: ['painting-1', 'painting-2']
      }
    } as never)

    expect(createPaintingMock).toHaveBeenCalledWith({
      providerId: 'aihubmix',
      mode: 'generate',
      prompt: 'hello'
    })
    expect(reorderPaintingsMock).toHaveBeenCalledWith({
      orderedIds: ['painting-1', 'painting-2']
    })
  })

  it('delegates get, patch, and delete by id', async () => {
    getPaintingByIdMock.mockResolvedValueOnce({ id: 'painting-1' })
    updatePaintingMock.mockResolvedValueOnce({ id: 'painting-1', prompt: 'updated' })
    deletePaintingMock.mockResolvedValueOnce(undefined)

    await expect(paintingHandlers['/paintings/:id'].GET({ params: { id: 'painting-1' } })).resolves.toEqual({
      id: 'painting-1'
    })
    await expect(
      paintingHandlers['/paintings/:id'].PATCH({
        params: { id: 'painting-1' },
        body: { parentId: null, prompt: 'updated' }
      } as never)
    ).resolves.toEqual({
      id: 'painting-1',
      prompt: 'updated'
    })
    await expect(
      paintingHandlers['/paintings/:id'].DELETE({
        params: { id: 'painting-1' }
      })
    ).resolves.toBeUndefined()

    expect(getPaintingByIdMock).toHaveBeenCalledWith('painting-1')
    expect(updatePaintingMock).toHaveBeenCalledWith('painting-1', { parentId: null, prompt: 'updated' })
    expect(deletePaintingMock).toHaveBeenCalledWith('painting-1')
  })
})
