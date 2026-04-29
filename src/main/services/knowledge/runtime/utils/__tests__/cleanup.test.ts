import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, vectorStoreDeleteMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  vectorStoreDeleteMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: appGetMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    updateStatus: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

const { deleteItemVectors } = await import('../cleanup')

function createBase(): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    emoji: '📁',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    chunkSize: 1024,
    chunkOverlap: 200,
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
    appGetMock.mockReturnValue({
      getStoreIfExists: vi.fn().mockResolvedValue({
        delete: vectorStoreDeleteMock
      })
    })
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
