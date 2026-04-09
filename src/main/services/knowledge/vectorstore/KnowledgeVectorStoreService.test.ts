import type * as LifecycleModule from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { providerCreateMock, providerDeleteMock } = vi.hoisted(() => ({
  providerCreateMock: vi.fn(),
  providerDeleteMock: vi.fn()
}))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()

  class MockBaseService {}

  return {
    ...actual,
    BaseService: MockBaseService
  }
})

vi.mock('@vectorstores/libsql', () => {
  class MockLibSQLVectorStore {
    closeMock = vi.fn()

    client() {
      return {
        close: this.closeMock
      }
    }
  }

  return {
    LibSQLVectorStore: MockLibSQLVectorStore
  }
})

vi.mock('./providers/LibSqlVectorStoreProvider', () => ({
  libSqlVectorStoreProvider: {
    create: providerCreateMock,
    delete: providerDeleteMock
  }
}))

const { KnowledgeVectorStoreService } = await import('./KnowledgeVectorStoreService')
const { LibSQLVectorStore } = await import('@vectorstores/libsql')

function createBase(id = 'kb-1') {
  return {
    id,
    name: 'KB',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createStore(closeMock = vi.fn()) {
  const store = new LibSQLVectorStore({})
  ;(store as unknown as { closeMock: () => void }).closeMock = closeMock
  return store
}

describe('KnowledgeVectorStoreService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('evicts a cached store even when provider delete fails', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    const firstCloseMock = vi.fn()
    const firstStore = createStore(firstCloseMock)
    const secondStore = createStore()

    providerCreateMock.mockResolvedValueOnce(firstStore).mockResolvedValueOnce(secondStore)
    providerDeleteMock.mockRejectedValueOnce(new Error('delete failed'))

    await expect(service.createStore(base)).resolves.toBe(firstStore)
    await expect(service.deleteStore(base.id)).rejects.toThrow('delete failed')
    await expect(service.createStore(base)).resolves.toBe(secondStore)

    expect(firstCloseMock).toHaveBeenCalledTimes(1)
    expect(providerCreateMock).toHaveBeenCalledTimes(2)
  })

  it('clears cached stores during stop after closing them', async () => {
    const service = new KnowledgeVectorStoreService()
    const firstStore = createStore()
    const secondCloseMock = vi.fn()
    const secondStore = createStore(secondCloseMock)

    providerCreateMock.mockResolvedValueOnce(firstStore).mockResolvedValueOnce(secondStore)

    await service.createStore(createBase('kb-1'))
    await service.createStore(createBase('kb-2'))

    await (service as any).onStop()

    const replacementStore = createStore()
    providerCreateMock.mockResolvedValueOnce(replacementStore)

    await expect(service.createStore(createBase('kb-2'))).resolves.toBe(replacementStore)
    expect(secondCloseMock).toHaveBeenCalledTimes(1)
  })
})
