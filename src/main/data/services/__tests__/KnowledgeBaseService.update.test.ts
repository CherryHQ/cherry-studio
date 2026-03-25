import { ErrorCode } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/db/DbService', () => ({
  dbService: {
    getDb: vi.fn()
  }
}))

import { dbService } from '@data/db/DbService'

import { KnowledgeBaseService } from '../KnowledgeBaseService'

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'kb-1',
  name: 'Knowledge Base',
  description: 'desc',
  dimensions: 1024,
  embeddingModelId: 'provider::model',
  rerankModelId: null,
  fileProcessorId: null,
  chunkSize: 500,
  chunkOverlap: 100,
  threshold: 0.5,
  documentCount: 1,
  searchMode: 'default',
  hybridAlpha: null,
  createdAt: 1710000000000,
  updatedAt: 1710000000000,
  ...overrides
})

describe('KnowledgeBaseService.update', () => {
  const getDbMock = vi.mocked(dbService.getDb)
  const service = KnowledgeBaseService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates effective config and trims valid names before persisting', async () => {
    await expect(service.update('kb-1', { name: '   ' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 422,
      details: {
        fieldErrors: {
          name: ['Name is required']
        }
      }
    })

    expect(getDbMock).not.toHaveBeenCalled()

    const invalidOverlapLimitMock = vi.fn().mockResolvedValue([buildRow()])
    const invalidOverlapWhereSelectMock = vi.fn().mockReturnValue({ limit: invalidOverlapLimitMock })
    const invalidOverlapFromMock = vi.fn().mockReturnValue({ where: invalidOverlapWhereSelectMock })
    const invalidOverlapSelectMock = vi.fn().mockReturnValue({ from: invalidOverlapFromMock })
    const invalidOverlapUpdateMock = vi.fn()
    const invalidOverlapDb = {
      select: invalidOverlapSelectMock,
      update: invalidOverlapUpdateMock
    }

    getDbMock.mockReturnValue(invalidOverlapDb as never)

    await expect(service.update('kb-1', { chunkOverlap: 500 })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 422,
      details: {
        fieldErrors: {
          chunkOverlap: ['chunkOverlap must be smaller than chunkSize']
        }
      }
    })

    expect(invalidOverlapUpdateMock).not.toHaveBeenCalled()

    const invalidHybridLimitMock = vi.fn().mockResolvedValue([buildRow()])
    const invalidHybridWhereSelectMock = vi.fn().mockReturnValue({ limit: invalidHybridLimitMock })
    const invalidHybridFromMock = vi.fn().mockReturnValue({ where: invalidHybridWhereSelectMock })
    const invalidHybridSelectMock = vi.fn().mockReturnValue({ from: invalidHybridFromMock })
    const invalidHybridUpdateMock = vi.fn()
    const invalidHybridDb = {
      select: invalidHybridSelectMock,
      update: invalidHybridUpdateMock
    }

    getDbMock.mockReturnValue(invalidHybridDb as never)

    await expect(service.update('kb-1', { hybridAlpha: 0.5 })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 422,
      details: {
        fieldErrors: {
          hybridAlpha: ['hybridAlpha can only be set when searchMode is hybrid']
        }
      }
    })

    expect(invalidHybridUpdateMock).not.toHaveBeenCalled()

    const validLimitMock = vi.fn().mockResolvedValue([buildRow()])
    const validWhereSelectMock = vi.fn().mockReturnValue({ limit: validLimitMock })
    const validFromMock = vi.fn().mockReturnValue({ where: validWhereSelectMock })
    const validSelectMock = vi.fn().mockReturnValue({ from: validFromMock })
    const returningMock = vi.fn().mockResolvedValue([buildRow({ name: 'Renamed KB' })])
    const whereUpdateMock = vi.fn().mockReturnValue({ returning: returningMock })
    const setMock = vi.fn().mockReturnValue({ where: whereUpdateMock })
    const validUpdateMock = vi.fn().mockReturnValue({ set: setMock })
    const validDb = {
      select: validSelectMock,
      update: validUpdateMock
    }

    getDbMock.mockReturnValue(validDb as never)

    const result = await service.update('kb-1', { name: '  Renamed KB  ' })

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Renamed KB'
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        name: 'Renamed KB'
      })
    )
  })

  it('allows explicit null clearing for nullable config fields when leaving hybrid mode', async () => {
    const limitMock = vi.fn().mockResolvedValue([
      buildRow({
        description: 'existing description',
        rerankModelId: 'provider::rerank',
        fileProcessorId: 'processor-1',
        chunkSize: 600,
        chunkOverlap: 120,
        threshold: 0.7,
        documentCount: 8,
        searchMode: 'hybrid',
        hybridAlpha: 0.5
      })
    ])
    const whereSelectMock = vi.fn().mockReturnValue({ limit: limitMock })
    const fromMock = vi.fn().mockReturnValue({ where: whereSelectMock })
    const selectMock = vi.fn().mockReturnValue({ from: fromMock })
    const returningMock = vi.fn().mockResolvedValue([
      buildRow({
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
    ])
    const whereUpdateMock = vi.fn().mockReturnValue({ returning: returningMock })
    const setMock = vi.fn().mockReturnValue({ where: whereUpdateMock })
    const updateMock = vi.fn().mockReturnValue({ set: setMock })

    getDbMock.mockReturnValue({
      select: selectMock,
      update: updateMock
    } as never)

    const result = await service.update('kb-1', {
      description: null,
      rerankModelId: null,
      fileProcessorId: null,
      chunkSize: null,
      chunkOverlap: null,
      threshold: null,
      documentCount: null,
      searchMode: 'default',
      hybridAlpha: null
    } as never)

    expect(setMock).toHaveBeenCalledWith({
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
    expect(result).toEqual(
      expect.objectContaining({
        description: undefined,
        rerankModelId: undefined,
        fileProcessorId: undefined,
        chunkSize: undefined,
        chunkOverlap: undefined,
        threshold: undefined,
        documentCount: undefined,
        searchMode: 'default',
        hybridAlpha: undefined
      })
    )
  })
})
