import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listPaintingsMock,
  createPaintingMock,
  getPaintingByIdMock,
  updatePaintingMock,
  deletePaintingMock,
  reorderPaintingMock,
  reorderPaintingBatchMock
} = vi.hoisted(() => ({
  listPaintingsMock: vi.fn(),
  createPaintingMock: vi.fn(),
  getPaintingByIdMock: vi.fn(),
  updatePaintingMock: vi.fn(),
  deletePaintingMock: vi.fn(),
  reorderPaintingMock: vi.fn(),
  reorderPaintingBatchMock: vi.fn()
}))

vi.mock('@data/services/PaintingService', () => ({
  paintingService: {
    list: listPaintingsMock,
    create: createPaintingMock,
    getById: getPaintingByIdMock,
    update: updatePaintingMock,
    delete: deletePaintingMock,
    reorder: reorderPaintingMock,
    reorderBatch: reorderPaintingBatchMock
  }
}))

import {
  PAINTINGS_DEFAULT_LIMIT,
  PAINTINGS_DEFAULT_OFFSET,
  PAINTINGS_MAX_LIMIT
} from '@shared/data/api/schemas/paintings'

import { paintingHandlers } from '../paintings'

describe('paintingHandlers', () => {
  const legacyParentFieldKey = ['parent', 'Id'].join('')

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

  it('rejects the legacy parent field and invalid mediaType payloads before calling the service', async () => {
    await expect(
      paintingHandlers['/paintings'].GET({
        query: {
          [legacyParentFieldKey]: 'painting-parent'
        } as never
      } as never)
    ).rejects.toHaveProperty('name', 'ZodError')

    await expect(
      paintingHandlers['/paintings'].POST({
        body: {
          providerId: 'aihubmix',
          mode: 'generate',
          mediaType: 'audio'
        }
      } as never)
    ).rejects.toHaveProperty('name', 'ZodError')

    await expect(
      paintingHandlers['/paintings'].POST({
        body: {
          providerId: 'aihubmix',
          mode: 'generate',
          [legacyParentFieldKey]: null
        }
      } as never)
    ).rejects.toHaveProperty('name', 'ZodError')

    await expect(
      paintingHandlers['/paintings/:id'].PATCH({
        params: { id: 'painting-1' },
        body: {
          [legacyParentFieldKey]: null
        }
      } as never)
    ).rejects.toHaveProperty('name', 'ZodError')

    expect(listPaintingsMock).not.toHaveBeenCalled()
    expect(createPaintingMock).not.toHaveBeenCalled()
    expect(updatePaintingMock).not.toHaveBeenCalled()
  })

  it('parses create and order payloads before delegating', async () => {
    createPaintingMock.mockResolvedValueOnce({ id: 'painting-1' })
    reorderPaintingMock.mockResolvedValueOnce(undefined)
    reorderPaintingBatchMock.mockResolvedValueOnce(undefined)

    await paintingHandlers['/paintings'].POST({
      body: {
        providerId: '  aihubmix  ',
        mode: 'generate',
        mediaType: 'video',
        prompt: 'hello',
        params: {},
        files: { output: [], input: [] }
      }
    } as never)

    await paintingHandlers['/paintings/:id/order'].PATCH({
      params: { id: 'painting-2' },
      body: { after: 'painting-1' }
    } as never)

    await paintingHandlers['/paintings/order:batch'].PATCH({
      body: {
        moves: [
          { id: 'painting-2', anchor: { position: 'first' } },
          { id: 'painting-1', anchor: { after: 'painting-2' } }
        ]
      }
    } as never)

    expect(createPaintingMock).toHaveBeenCalledWith({
      providerId: 'aihubmix',
      mode: 'generate',
      mediaType: 'video',
      prompt: 'hello',
      params: {},
      files: { output: [], input: [] }
    })
    expect(reorderPaintingMock).toHaveBeenCalledWith('painting-2', { after: 'painting-1' })
    expect(reorderPaintingBatchMock).toHaveBeenCalledWith([
      { id: 'painting-2', anchor: { position: 'first' } },
      { id: 'painting-1', anchor: { after: 'painting-2' } }
    ])
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
        body: { mediaType: 'video', prompt: 'updated' }
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
    expect(updatePaintingMock).toHaveBeenCalledWith('painting-1', { mediaType: 'video', prompt: 'updated' })
    expect(deletePaintingMock).toHaveBeenCalledWith('painting-1')
  })
})
