import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listCreationsMock,
  createCreationMock,
  getCreationByIdMock,
  updateCreationMock,
  deleteCreationMock,
  reorderCreationMock,
  reorderCreationBatchMock
} = vi.hoisted(() => ({
  listCreationsMock: vi.fn(),
  createCreationMock: vi.fn(),
  getCreationByIdMock: vi.fn(),
  updateCreationMock: vi.fn(),
  deleteCreationMock: vi.fn(),
  reorderCreationMock: vi.fn(),
  reorderCreationBatchMock: vi.fn()
}))

vi.mock('@data/services/CreationService', () => ({
  creationService: {
    list: listCreationsMock,
    create: createCreationMock,
    getById: getCreationByIdMock,
    update: updateCreationMock,
    delete: deleteCreationMock,
    reorder: reorderCreationMock,
    reorderBatch: reorderCreationBatchMock
  }
}))

import { CREATIONS_DEFAULT_LIMIT, CREATIONS_MAX_LIMIT } from '@shared/data/api/schemas/creations'

import { creationHandlers } from '../creations'

describe('creationHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies default cursor pagination when query is missing', async () => {
    listCreationsMock.mockResolvedValueOnce({ items: [], total: 0, nextCursor: undefined })

    await creationHandlers['/creations'].GET({})

    expect(listCreationsMock).toHaveBeenCalledWith({ limit: CREATIONS_DEFAULT_LIMIT })
  })

  it('passes the kind filter through to the service', async () => {
    listCreationsMock.mockResolvedValueOnce({ items: [], total: 0, nextCursor: undefined })

    await creationHandlers['/creations'].GET({ query: { kind: 'video' } } as never)

    expect(listCreationsMock).toHaveBeenCalledWith({ kind: 'video', limit: CREATIONS_DEFAULT_LIMIT })
  })

  it('rejects invalid list query before calling the service', async () => {
    await expect(
      creationHandlers['/creations'].GET({ query: { limit: CREATIONS_MAX_LIMIT + 1 } as never } as never)
    ).rejects.toHaveProperty('name', 'ZodError')

    expect(listCreationsMock).not.toHaveBeenCalled()
  })

  it('rejects a create body missing the required kind, and unknown keys', async () => {
    await expect(
      creationHandlers['/creations'].POST({
        body: { providerId: 'aihubmix', prompt: 'x', files: { output: [], input: [] } }
      } as never)
    ).rejects.toHaveProperty('name', 'ZodError')

    await expect(
      creationHandlers['/creations'].POST({
        body: { kind: 'image', providerId: 'aihubmix', prompt: 'x', files: { output: [], input: [] }, mode: 'generate' }
      } as never)
    ).rejects.toHaveProperty('name', 'ZodError')

    expect(createCreationMock).not.toHaveBeenCalled()
  })

  it('parses create and order payloads before delegating', async () => {
    createCreationMock.mockResolvedValueOnce({ id: 'creation-1' })
    reorderCreationMock.mockResolvedValueOnce(undefined)
    reorderCreationBatchMock.mockResolvedValueOnce(undefined)

    await creationHandlers['/creations'].POST({
      body: { kind: 'video', providerId: '  dmxapi  ', prompt: 'hello', files: { output: [], input: [] } }
    } as never)

    await creationHandlers['/creations/:id/order'].PATCH({
      params: { id: 'creation-2' },
      body: { after: 'creation-1' }
    } as never)

    await creationHandlers['/creations/order:batch'].PATCH({
      body: {
        moves: [
          { id: 'creation-2', anchor: { position: 'first' } },
          { id: 'creation-1', anchor: { after: 'creation-2' } }
        ]
      }
    } as never)

    expect(createCreationMock).toHaveBeenCalledWith({
      kind: 'video',
      providerId: 'dmxapi',
      prompt: 'hello',
      files: { output: [], input: [] }
    })
    expect(reorderCreationMock).toHaveBeenCalledWith('creation-2', { after: 'creation-1' })
    expect(reorderCreationBatchMock).toHaveBeenCalledWith([
      { id: 'creation-2', anchor: { position: 'first' } },
      { id: 'creation-1', anchor: { after: 'creation-2' } }
    ])
  })

  it('delegates get, patch, and delete by id', async () => {
    getCreationByIdMock.mockResolvedValueOnce({ id: 'creation-1' })
    updateCreationMock.mockResolvedValueOnce({ id: 'creation-1', prompt: 'updated' })
    deleteCreationMock.mockResolvedValueOnce(undefined)

    await expect(creationHandlers['/creations/:id'].GET({ params: { id: 'creation-1' } })).resolves.toEqual({
      id: 'creation-1'
    })
    await expect(
      creationHandlers['/creations/:id'].PATCH({ params: { id: 'creation-1' }, body: { prompt: 'updated' } } as never)
    ).resolves.toEqual({ id: 'creation-1', prompt: 'updated' })
    await expect(creationHandlers['/creations/:id'].DELETE({ params: { id: 'creation-1' } })).resolves.toBeUndefined()

    expect(getCreationByIdMock).toHaveBeenCalledWith('creation-1')
    expect(updateCreationMock).toHaveBeenCalledWith('creation-1', { prompt: 'updated' })
    expect(deleteCreationMock).toHaveBeenCalledWith('creation-1')
  })
})
