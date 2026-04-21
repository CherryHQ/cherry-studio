import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  type KnowledgeBase
} from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, getStoreIfExistsMock, knowledgeItemUpdateMock, loggerErrorMock, loggerWarnMock, vectorDeleteMock } =
  vi.hoisted(() => ({
    appGetMock: vi.fn(),
    getStoreIfExistsMock: vi.fn(),
    knowledgeItemUpdateMock: vi.fn(),
    loggerErrorMock: vi.fn(),
    loggerWarnMock: vi.fn(),
    vectorDeleteMock: vi.fn()
  }))

vi.mock('@application', () => ({
  application: {
    get: appGetMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    update: knowledgeItemUpdateMock
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: loggerWarnMock,
      error: loggerErrorMock
    })
  }
}))

const { deleteItemVectors, deleteVectorsForEntries, failItems } = await import('../cleanup')

function createBase(): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    emoji: '📁',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    appGetMock.mockImplementation((serviceName: string) => {
      if (serviceName === 'KnowledgeVectorStoreService') {
        return {
          getStoreIfExists: getStoreIfExistsMock
        }
      }

      throw new Error(`Unexpected application.get(${serviceName}) in test`)
    })
  })

  it('does nothing when no vector store exists for the base', async () => {
    const base = createBase()

    getStoreIfExistsMock.mockResolvedValueOnce(undefined)

    await expect(deleteItemVectors(base, ['item-1'])).resolves.toBeUndefined()

    expect(getStoreIfExistsMock).toHaveBeenCalledWith(base)
    expect(vectorDeleteMock).not.toHaveBeenCalled()
  })

  it('deduplicates item ids before deleting from an existing vector store', async () => {
    const base = createBase()

    getStoreIfExistsMock.mockResolvedValueOnce({
      delete: vectorDeleteMock
    })
    vectorDeleteMock.mockResolvedValue(undefined)

    await expect(deleteItemVectors(base, ['item-1', 'item-1', 'item-2'])).resolves.toBeUndefined()

    expect(getStoreIfExistsMock).toHaveBeenCalledWith(base)
    expect(vectorDeleteMock).toHaveBeenCalledTimes(2)
    expect(vectorDeleteMock).toHaveBeenCalledWith('item-1')
    expect(vectorDeleteMock).toHaveBeenCalledWith('item-2')
  })

  it('keeps deleting remaining items and reports partial failures', async () => {
    const base = createBase()
    const deleteError = new Error('delete failed for item-2')

    getStoreIfExistsMock.mockResolvedValueOnce({
      delete: vectorDeleteMock
    })
    vectorDeleteMock.mockImplementation(async (itemId: string) => {
      if (itemId === 'item-2') {
        throw deleteError
      }
    })

    await expect(deleteItemVectors(base, ['item-1', 'item-2'])).rejects.toMatchObject({
      name: 'DeleteItemVectorsError',
      message: 'Failed to delete vectors for knowledge items in base kb-1: item-2',
      baseId: 'kb-1',
      succeededItemIds: ['item-1'],
      failed: [
        {
          itemId: 'item-2',
          error: deleteError
        }
      ]
    })

    expect(vectorDeleteMock).toHaveBeenCalledTimes(2)
    expect(vectorDeleteMock).toHaveBeenCalledWith('item-1')
    expect(vectorDeleteMock).toHaveBeenCalledWith('item-2')
  })

  it('logs partial vector cleanup failures and continues when continueOnError is enabled', async () => {
    const base = createBase()

    getStoreIfExistsMock.mockResolvedValueOnce({
      delete: vectorDeleteMock
    })
    vectorDeleteMock.mockImplementation(async (itemId: string) => {
      if (itemId === 'item-2') {
        throw new Error('delete failed for item-2')
      }
    })

    await expect(
      deleteVectorsForEntries(
        [
          {
            base,
            item: {
              id: 'item-1'
            }
          },
          {
            base,
            item: {
              id: 'item-2'
            }
          }
        ] as any,
        { continueOnError: true }
      )
    ).resolves.toBeUndefined()

    expect(loggerWarnMock).toHaveBeenCalledWith('Failed to delete knowledge item vectors during interruption cleanup', {
      baseId: 'kb-1',
      itemIds: ['item-1', 'item-2'],
      succeededItemIds: ['item-1'],
      failedItemIds: ['item-2'],
      cleanupError: 'Failed to delete vectors for knowledge items in base kb-1: item-2'
    })
  })

  it('throws vector cleanup errors when continueOnError is disabled', async () => {
    const base = createBase()

    getStoreIfExistsMock.mockResolvedValueOnce({
      delete: vectorDeleteMock
    })
    vectorDeleteMock.mockRejectedValueOnce(new Error('delete failed for item-1'))

    await expect(
      deleteVectorsForEntries(
        [
          {
            base,
            item: { id: 'item-1' }
          }
        ] as any,
        { continueOnError: false }
      )
    ).rejects.toMatchObject({
      name: 'DeleteItemVectorsError',
      baseId: 'kb-1',
      failed: [
        {
          itemId: 'item-1'
        }
      ]
    })

    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  it('groups entries by base before deleting vectors', async () => {
    const firstBase = createBase()
    const secondBase = {
      ...createBase(),
      id: 'kb-2'
    }

    getStoreIfExistsMock
      .mockResolvedValueOnce({ delete: vectorDeleteMock })
      .mockResolvedValueOnce({ delete: vectorDeleteMock })
    vectorDeleteMock.mockResolvedValue(undefined)

    await expect(
      deleteVectorsForEntries(
        [
          { base: firstBase, item: { id: 'item-1' } },
          { base: firstBase, item: { id: 'item-2' } },
          { base: secondBase, item: { id: 'item-3' } }
        ] as any,
        { continueOnError: true }
      )
    ).resolves.toBeUndefined()

    expect(getStoreIfExistsMock).toHaveBeenNthCalledWith(1, firstBase)
    expect(getStoreIfExistsMock).toHaveBeenNthCalledWith(2, secondBase)
    expect(vectorDeleteMock).toHaveBeenCalledWith('item-1')
    expect(vectorDeleteMock).toHaveBeenCalledWith('item-2')
    expect(vectorDeleteMock).toHaveBeenCalledWith('item-3')
  })

  it('marks interrupted items as failed and logs persistence errors per item', async () => {
    knowledgeItemUpdateMock.mockImplementation(async (itemId: string) => {
      if (itemId === 'item-2') {
        throw new Error('persist failed')
      }
    })

    await expect(failItems(['item-1', 'item-2', 'item-1'], 'stop')).resolves.toBeUndefined()

    expect(knowledgeItemUpdateMock).toHaveBeenCalledTimes(2)
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith('item-1', {
      status: 'failed',
      error: 'stop'
    })
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith('item-2', {
      status: 'failed',
      error: 'stop'
    })
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to persist interrupted knowledge item state',
      expect.objectContaining({ message: 'persist failed' }),
      {
        itemId: 'item-2',
        reason: 'stop'
      }
    )
  })
})
