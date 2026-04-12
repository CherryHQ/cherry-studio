import type { ReorderPaintingsDto } from '@shared/data/api/schemas/paintings'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let capturedInsertValues: unknown = null
let updateOperations: number[] = []

function createPaintingServiceMockDb(options?: {
  maxSortOrder?: number
  scopeIds?: string[]
  existingRow?: Record<string, unknown>
}) {
  const maxSortOrder = options?.maxSortOrder ?? 0
  const scopeIds = options?.scopeIds ?? []
  const existingRow = options?.existingRow ?? {
    id: 'painting-1',
    providerId: 'aihubmix',
    mode: 'generate',
    model: 'model-a',
    prompt: 'hello',
    params: {},
    fileIds: [],
    inputFileIds: [],
    parentId: null,
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1
  }

  const tx = {
    select: vi.fn(({ maxSortOrder: selectedMaxSortOrder }: Record<string, unknown> = {}) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(async () => (selectedMaxSortOrder !== undefined ? { maxSortOrder } : null)),
          all: vi.fn(async () => scopeIds.map((id) => ({ id })))
        }))
      }))
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        capturedInsertValues = values
        return {
          returning: vi.fn(async () => [values])
        }
      })
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => {
          updateOperations.push(values.sortOrder as number)
          return {
            returning: vi.fn(async () => [{ ...existingRow, ...values }])
          }
        })
      }))
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => undefined)
    }))
  }

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [existingRow])
        }))
      }))
    })),
    update: tx.update,
    delete: tx.delete,
    transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx))
  }
}

vi.mock('@main/core/application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { paintingService } = await import('../PaintingService')

describe('PaintingService', () => {
  beforeEach(() => {
    capturedInsertValues = null
    updateOperations = []
    vi.clearAllMocks()
  })

  it('assigns the next sort order when creating a painting', async () => {
    MockMainDbServiceUtils.setDb(createPaintingServiceMockDb({ maxSortOrder: 7 }))

    await paintingService.create({
      providerId: 'aihubmix',
      mode: 'generate',
      prompt: 'hello'
    })

    expect(capturedInsertValues).toMatchObject({
      providerId: 'aihubmix',
      mode: 'generate',
      sortOrder: 8
    })
  })

  it('rejects reorder payloads with duplicate ids before touching the database', async () => {
    MockMainDbServiceUtils.setDb(createPaintingServiceMockDb())

    await expect(
      paintingService.reorder({
        providerId: 'aihubmix',
        mode: 'generate',
        orderedIds: ['painting-1', 'painting-1']
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
  })

  it('reorders every record in the target scope', async () => {
    MockMainDbServiceUtils.setDb(createPaintingServiceMockDb({ scopeIds: ['painting-1', 'painting-2', 'painting-3'] }))

    const dto: ReorderPaintingsDto = {
      providerId: 'aihubmix',
      mode: 'generate',
      orderedIds: ['painting-3', 'painting-1', 'painting-2']
    }

    const result = await paintingService.reorder(dto)

    expect(result).toEqual({ reorderedCount: 3 })
    expect(updateOperations).toEqual([3, 2, 1])
  })
})
