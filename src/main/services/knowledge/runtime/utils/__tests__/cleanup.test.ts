import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, getStoreIfExistsMock, vectorDeleteMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  getStoreIfExistsMock: vi.fn(),
  vectorDeleteMock: vi.fn()
}))

vi.mock('@main/core/application', () => ({
  application: {
    get: appGetMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    update: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

const { deleteItemVectors } = await import('../cleanup')

function createBase() {
  return {
    id: 'kb-1',
    name: 'KB',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
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
})
