import { dbService } from '@data/db/DbService'
import { ErrorCode } from '@shared/data/api/apiErrors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { knowledgeBaseService } from './KnowledgeBaseService'

vi.mock('@data/db/DbService', () => ({
  dbService: {
    getDb: vi.fn()
  }
}))

const createBaseRow = () => ({
  id: 'kb-1',
  name: 'Knowledge Base',
  description: null,
  dimensions: 1024,
  embeddingModelId: 'silicon::BAAI/bge-m3',
  embeddingModelMeta: null,
  rerankModelId: null,
  rerankModelMeta: null,
  fileProcessorId: null,
  chunkSize: null,
  chunkOverlap: null,
  threshold: null,
  documentCount: null,
  searchMode: null,
  hybridAlpha: null,
  createdAt: Date.now(),
  updatedAt: Date.now()
})

describe('KnowledgeBaseService validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('create rejects invalid searchMode before DB write', async () => {
    const insert = vi.fn()
    const getDbMock = dbService.getDb as unknown as ReturnType<typeof vi.fn>
    getDbMock.mockReturnValue({ insert } as any)

    await expect(
      knowledgeBaseService.create({
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'silicon::BAAI/bge-m3',
        searchMode: 'invalid-mode' as any
      })
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 422
    })

    expect(insert).not.toHaveBeenCalled()
  })

  it('update rejects empty payload before DB write', async () => {
    const row = createBaseRow()
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

    await expect(knowledgeBaseService.update('kb-1', {})).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 422
    })

    expect(update).not.toHaveBeenCalled()
  })

  it('update rejects invalid searchMode before DB write', async () => {
    const row = createBaseRow()
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
      knowledgeBaseService.update('kb-1', {
        searchMode: 'invalid-mode' as any
      })
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 422
    })

    expect(update).not.toHaveBeenCalled()
  })
})
