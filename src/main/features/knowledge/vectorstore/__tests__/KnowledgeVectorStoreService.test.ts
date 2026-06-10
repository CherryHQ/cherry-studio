import type * as LifecycleModule from '@main/core/lifecycle'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  type KnowledgeBase
} from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  loggerDebugMock,
  loggerErrorMock,
  loggerInfoMock,
  openDriverMock,
  createSchemaMock,
  indexStoreCtorMock,
  getPathMock,
  getPathSyncMock,
  deleteDirMock,
  statMock
} = vi.hoisted(() => ({
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  openDriverMock: vi.fn(),
  createSchemaMock: vi.fn(),
  indexStoreCtorMock: vi.fn(),
  getPathMock: vi.fn(),
  getPathSyncMock: vi.fn(),
  deleteDirMock: vi.fn(),
  statMock: vi.fn()
}))

vi.mock('node:fs', () => ({
  default: { promises: { stat: statMock } }
}))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()

  class MockBaseService {}

  return {
    ...actual,
    BaseService: MockBaseService
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: loggerDebugMock,
      info: loggerInfoMock,
      error: loggerErrorMock
    })
  }
}))

vi.mock('../indexStore/KnowledgeIndexStore', () => ({
  KnowledgeIndexStore: indexStoreCtorMock
}))

vi.mock('../indexStore/LibsqlDriver', () => ({
  openLibsqlIndexDriver: openDriverMock
}))

vi.mock('../indexStore/LibsqlVectorIndex', () => ({
  libsqlVectorIndex: { kind: 'libsql' }
}))

vi.mock('../indexStore/schema', () => ({
  createKnowledgeIndexSchema: createSchemaMock
}))

vi.mock('../../utils/storage/pathStorage', () => ({
  getKnowledgeVectorStoreFilePath: getPathMock,
  getKnowledgeVectorStoreFilePathSync: getPathSyncMock,
  deleteKnowledgeBaseDir: deleteDirMock
}))

const { KnowledgeVectorStoreService } = await import('../KnowledgeVectorStoreService')

function createBase(id = 'kb-1'): KnowledgeBase {
  return {
    id,
    name: 'KB',
    groupId: null,
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    status: 'completed',
    error: null,
    chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    searchMode: 'hybrid',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

/** The store instance built by the most recent `new KnowledgeIndexStore(...)` call. */
function lastStore() {
  const results = indexStoreCtorMock.mock.results
  return results[results.length - 1]?.value as { close: ReturnType<typeof vi.fn> }
}

describe('KnowledgeVectorStoreService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPathMock.mockImplementation(async (baseId: string) => `/tmp/${baseId}/index.sqlite`)
    getPathSyncMock.mockImplementation((baseId: string) => `/tmp/${baseId}/index.sqlite`)
    openDriverMock.mockResolvedValue({ kind: 'driver' })
    createSchemaMock.mockResolvedValue(undefined)
    deleteDirMock.mockResolvedValue(undefined)
    indexStoreCtorMock.mockImplementation(() => ({ close: vi.fn().mockResolvedValue(undefined) }))
  })

  it('opens an index store on first request and caches it per base', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()

    const first = await service.getIndexStore(base)
    const second = await service.getIndexStore(base)

    expect(first).toBe(second)
    expect(indexStoreCtorMock).toHaveBeenCalledTimes(1)
    expect(openDriverMock).toHaveBeenCalledTimes(1)
    expect(createSchemaMock).toHaveBeenCalledTimes(1)
    expect(loggerInfoMock).toHaveBeenCalledWith('Opened knowledge index store', { baseId: base.id, cacheSize: 1 })
    expect(loggerDebugMock).toHaveBeenCalledWith('Reusing cached knowledge index store', { baseId: base.id })
  })

  it('shares a single open across concurrent callers for the same base (single-flight)', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()

    // Both calls are issued before the first open resolves; the second must join
    // the first's in-flight open rather than starting its own (which would leak a
    // store no one closes).
    const [first, second] = await Promise.all([service.getIndexStore(base), service.getIndexStore(base)])

    expect(first).toBe(second)
    expect(openDriverMock).toHaveBeenCalledTimes(1)
    expect(indexStoreCtorMock).toHaveBeenCalledTimes(1)
  })

  it('evicts a failed open so a later call retries instead of re-awaiting the failure', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    openDriverMock.mockRejectedValueOnce(new Error('open failed'))

    await expect(service.getIndexStore(base)).rejects.toThrow('open failed')

    const store = await service.getIndexStore(base)
    expect(store).toBe(lastStore())
    expect(openDriverMock).toHaveBeenCalledTimes(2)
    expect(indexStoreCtorMock).toHaveBeenCalledTimes(1)
  })

  it('returns undefined from getIndexStoreIfExists when no backing file exists', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    statMock.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    await expect(service.getIndexStoreIfExists(base)).resolves.toBeUndefined()

    expect(indexStoreCtorMock).not.toHaveBeenCalled()
    expect(loggerDebugMock).toHaveBeenCalledWith('Knowledge index store does not exist on disk', { baseId: base.id })
  })

  it('opens an existing store from disk when getIndexStoreIfExists detects a backing file', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    statMock.mockResolvedValueOnce({ isFile: () => true })

    const store = await service.getIndexStoreIfExists(base)

    expect(store).toBe(lastStore())
    expect(indexStoreCtorMock).toHaveBeenCalledTimes(1)
  })

  it('returns the cached store from getIndexStoreIfExists without probing disk', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()

    const created = await service.getIndexStore(base)

    await expect(service.getIndexStoreIfExists(base)).resolves.toBe(created)
    expect(statMock).not.toHaveBeenCalled()
  })

  it('closes the cached store and removes the base directory on deleteStore', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()

    const store = await service.getIndexStore(base)
    await service.deleteStore(base.id)

    expect(store.close).toHaveBeenCalledTimes(1)
    expect(deleteDirMock).toHaveBeenCalledWith(base.id)

    // Cache was evicted: the next open builds a fresh instance.
    const reopened = await service.getIndexStore(base)
    expect(reopened).not.toBe(store)
    expect(indexStoreCtorMock).toHaveBeenCalledTimes(2)
  })

  it('evicts the cached store even when directory removal fails', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    deleteDirMock.mockRejectedValueOnce(new Error('delete failed'))

    const store = await service.getIndexStore(base)
    await expect(service.deleteStore(base.id)).rejects.toThrow('delete failed')

    const reopened = await service.getIndexStore(base)
    expect(reopened).not.toBe(store)
    expect(indexStoreCtorMock).toHaveBeenCalledTimes(2)
  })

  it('closes all cached stores during stop and continues when one close throws', async () => {
    const service = new KnowledgeVectorStoreService()

    const first = await service.getIndexStore(createBase('kb-1'))
    const second = await service.getIndexStore(createBase('kb-2'))
    const closeError = new Error('close failed')
    ;(first.close as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(closeError)

    await expect((service as any).onStop()).resolves.toBeUndefined()

    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.close).toHaveBeenCalledTimes(1)
    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to close knowledge index store', closeError, {
      baseId: 'kb-1'
    })
    expect(loggerInfoMock).toHaveBeenCalledWith('Stopping knowledge index stores', { storeCount: 2 })
    expect(loggerInfoMock).toHaveBeenCalledWith('Stopped knowledge index stores', { storeCount: 2 })

    // Cache cleared: reopening kb-2 builds a fresh instance.
    const reopened = await service.getIndexStore(createBase('kb-2'))
    expect(reopened).not.toBe(second)
  })

  it('rejects bases that are not ready before touching disk', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = {
      ...createBase(),
      dimensions: null,
      embeddingModelId: null,
      status: 'failed',
      error: 'missing_embedding_model'
    } satisfies KnowledgeBase

    await expect(service.getIndexStore(base)).rejects.toThrow('not ready for vector store operations')
    await expect(service.getIndexStoreIfExists(base)).rejects.toThrow('not ready for vector store operations')

    expect(indexStoreCtorMock).not.toHaveBeenCalled()
    expect(statMock).not.toHaveBeenCalled()
  })
})
