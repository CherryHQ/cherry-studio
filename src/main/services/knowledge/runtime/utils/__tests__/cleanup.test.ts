import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  knowledgeItemUpdateStatusMock,
  loggerErrorMock,
  loggerWarnMock,
  vectorStoreDeleteMock,
  vectorStoreServiceMock
} = vi.hoisted(() => ({
  knowledgeItemUpdateStatusMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  vectorStoreDeleteMock: vi.fn(),
  vectorStoreServiceMock: {
    getStoreIfExists: vi.fn()
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeVectorStoreService: vectorStoreServiceMock
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    updateStatus: knowledgeItemUpdateStatusMock
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock,
      warn: loggerWarnMock
    })
  }
}))

const { deleteItemVectors, deleteVectorsForEntries, failItems } = await import('../cleanup')

function createBase(): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    groupId: null,
    emoji: '📁',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    chunkSize: 1024,
    chunkOverlap: 200,
    searchMode: 'hybrid',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('deleteItemVectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeItemUpdateStatusMock.mockResolvedValue(undefined)
    vectorStoreServiceMock.getStoreIfExists.mockResolvedValue({
      delete: vectorStoreDeleteMock
    })
  })

  it('does not delete vectors when the vector store does not exist', async () => {
    vectorStoreServiceMock.getStoreIfExists.mockResolvedValue(null)

    await expect(deleteItemVectors(createBase(), ['item-1'])).resolves.toBeUndefined()

    expect(vectorStoreDeleteMock).not.toHaveBeenCalled()
  })

  it('deduplicates item ids before deleting vectors', async () => {
    await deleteItemVectors(createBase(), ['item-1', 'item-1', 'item-2'])

    expect(vectorStoreDeleteMock).toHaveBeenCalledTimes(2)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith('item-1')
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith('item-2')
  })

  it('waits for every vector delete attempt before reporting failures', async () => {
    const pendingDelete = createDeferred()
    let rejected = false

    vectorStoreDeleteMock.mockImplementation(async (itemId: string) => {
      if (itemId === 'item-fail') {
        throw new Error('delete failed')
      }

      await pendingDelete.promise
    })

    const deletePromise = deleteItemVectors(createBase(), ['item-fail', 'item-slow']).catch((error: unknown) => {
      rejected = true
      throw error
    })

    await flushPromises()
    expect(rejected).toBe(false)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith('item-fail')
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith('item-slow')

    pendingDelete.resolve()
    await expect(deletePromise).rejects.toThrow('Failed to delete vectors for knowledge items in base kb-1: item-fail')
  })
})

describe('deleteVectorsForEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vectorStoreServiceMock.getStoreIfExists.mockResolvedValue({
      delete: vectorStoreDeleteMock
    })
  })

  it('logs and continues when deleting vectors fails for one base', async () => {
    const firstBase = createBase()
    const secondBase = { ...createBase(), id: 'kb-2' }
    vectorStoreDeleteMock.mockImplementation(async (itemId: string) => {
      if (itemId === 'item-fail') {
        throw new Error('delete failed')
      }
    })

    await expect(
      deleteVectorsForEntries([
        { base: firstBase, itemIds: ['item-fail'] },
        { base: secondBase, itemIds: ['item-ok'] }
      ])
    ).resolves.toBeUndefined()

    expect(vectorStoreDeleteMock).toHaveBeenCalledWith('item-fail')
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith('item-ok')
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to delete knowledge item vectors during runtime cleanup',
      expect.objectContaining({
        message: 'Failed to delete vectors for knowledge items in base kb-1: item-fail'
      }),
      {
        baseId: firstBase.id,
        itemIds: ['item-fail'],
        failedItemIds: ['item-fail']
      }
    )
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })
})

describe('failItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeItemUpdateStatusMock.mockResolvedValue(undefined)
  })

  it('marks unique item ids failed with the failure reason', async () => {
    await failItems(['item-1', 'item-1', 'item-2'], 'read failed')

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledTimes(2)
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('item-1', 'failed', { error: 'read failed' })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('item-2', 'failed', { error: 'read failed' })
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('throws an aggregate error after logging persistence failures', async () => {
    const persistError = new Error('database locked')
    knowledgeItemUpdateStatusMock.mockImplementation(async (itemId: string) => {
      if (itemId === 'item-fail') {
        throw persistError
      }
    })

    await expect(failItems(['item-ok', 'item-fail'], 'read failed')).rejects.toMatchObject({
      name: 'FailedToPersistFailureStateError',
      itemIds: ['item-fail'],
      reason: 'read failed'
    })

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('item-ok', 'failed', { error: 'read failed' })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('item-fail', 'failed', { error: 'read failed' })
    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to persist knowledge item failure state', persistError, {
      itemId: 'item-fail',
      reason: 'read failed'
    })
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to persist failure state for knowledge items',
      expect.objectContaining({ name: 'FailedToPersistFailureStateError' }),
      {
        count: 1,
        itemIds: ['item-fail'],
        reason: 'read failed'
      }
    )
  })
})
