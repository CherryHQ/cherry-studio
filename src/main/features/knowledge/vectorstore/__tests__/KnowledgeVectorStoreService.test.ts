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
  loggerWarnMock,
  openDriverMock,
  createSchemaMock,
  ensureIndexMetaMock,
  hasAnyMaterialMock,
  getItemsByBaseIdMock,
  indexStoreCtorMock,
  getPathMock,
  getPathSyncMock,
  deleteDirMock,
  statMock
} = vi.hoisted(() => ({
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  openDriverMock: vi.fn(),
  createSchemaMock: vi.fn(),
  ensureIndexMetaMock: vi.fn(),
  hasAnyMaterialMock: vi.fn(),
  getItemsByBaseIdMock: vi.fn(),
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
      error: loggerErrorMock,
      warn: loggerWarnMock
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

vi.mock('../indexStore/indexMeta', () => ({
  ensureIndexMeta: ensureIndexMetaMock,
  hasAnyMaterial: hasAnyMaterialMock
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: { getItemsByBaseId: getItemsByBaseIdMock }
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
    // Each open returns a fresh closeable driver so failure paths can assert close().
    openDriverMock.mockImplementation(async () => ({
      kind: 'driver',
      close: vi.fn().mockResolvedValue(undefined)
    }))
    createSchemaMock.mockResolvedValue(undefined)
    ensureIndexMetaMock.mockResolvedValue(undefined)
    // A non-empty material probe keeps the invisible-contents diagnostic quiet
    // unless a test opts in.
    hasAnyMaterialMock.mockResolvedValue(true)
    getItemsByBaseIdMock.mockResolvedValue([])
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

  it('stamps and verifies the meta identity row before handing out the store', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()

    await service.getIndexStore(base)

    expect(ensureIndexMetaMock).toHaveBeenCalledTimes(1)
    expect(ensureIndexMetaMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'driver' }), {
      baseId: base.id
    })
  })

  it('closes the driver and aborts the open when meta verification fails (wrong/corrupt base)', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    let openedDriver: { close: ReturnType<typeof vi.fn> } | undefined
    openDriverMock.mockImplementationOnce(async () => {
      openedDriver = { kind: 'driver', close: vi.fn().mockResolvedValue(undefined) } as never
      return openedDriver
    })
    ensureIndexMetaMock.mockRejectedValueOnce(new Error('belongs to a different base'))

    await expect(service.getIndexStore(base)).rejects.toThrow('belongs to a different base')

    expect(openedDriver?.close).toHaveBeenCalledTimes(1)
    expect(indexStoreCtorMock).not.toHaveBeenCalled()
  })

  it('closes the driver when schema creation fails so the file handle is not leaked', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    let openedDriver: { close: ReturnType<typeof vi.fn> } | undefined
    openDriverMock.mockImplementationOnce(async () => {
      openedDriver = { kind: 'driver', close: vi.fn().mockResolvedValue(undefined) } as never
      return openedDriver
    })
    createSchemaMock.mockRejectedValueOnce(new Error('disk full'))

    await expect(service.getIndexStore(base)).rejects.toThrow('disk full')

    expect(openedDriver?.close).toHaveBeenCalledTimes(1)
    expect(indexStoreCtorMock).not.toHaveBeenCalled()
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
    // Close must precede directory removal — on Windows a still-open sqlite
    // handle makes the directory deletion fail.
    expect((store.close as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      deleteDirMock.mock.invocationCallOrder[0]
    )

    // Cache was evicted: the next open builds a fresh instance.
    const reopened = await service.getIndexStore(base)
    expect(reopened).not.toBe(store)
    expect(indexStoreCtorMock).toHaveBeenCalledTimes(2)
  })

  it('deleteStore proceeds past a rejected in-flight open instead of re-throwing it', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    let rejectOpen: (error: Error) => void = () => {}
    openDriverMock.mockImplementationOnce(() => new Promise((_, reject) => (rejectOpen = reject)))

    // deleteStore grabs the still-pending open; when that open later fails, the
    // delete must not inherit the open error — a store that never opened needs
    // no close, and the directory removal has to go ahead.
    const opening = service.getIndexStore(base)
    const deleting = service.deleteStore(base.id)
    await vi.waitFor(() => expect(openDriverMock).toHaveBeenCalled())
    rejectOpen(new Error('open failed'))

    await expect(opening).rejects.toThrow('open failed')
    await expect(deleting).resolves.toBeUndefined()
    expect(deleteDirMock).toHaveBeenCalledWith(base.id)
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

    expect(indexStoreCtorMock).not.toHaveBeenCalled()
  })

  it('lets cleanup on a failed base proceed: getIndexStoreIfExists returns undefined instead of asserting', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = {
      ...createBase(),
      dimensions: null,
      embeddingModelId: null,
      status: 'failed',
      error: 'missing_embedding_model'
    } satisfies KnowledgeBase
    // Failed bases never get a store file (the vector migrator skips them and
    // getIndexStore asserts), so the existence probe is the path cleanup takes.
    statMock.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    await expect(service.getIndexStoreIfExists(base)).resolves.toBeUndefined()

    expect(indexStoreCtorMock).not.toHaveBeenCalled()
  })

  it('still asserts readiness when a failed base unexpectedly has a store file on disk', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = {
      ...createBase(),
      dimensions: null,
      embeddingModelId: null,
      status: 'failed',
      error: 'missing_embedding_model'
    } satisfies KnowledgeBase
    statMock.mockResolvedValueOnce({ isFile: () => true })

    await expect(service.getIndexStoreIfExists(base)).rejects.toThrow('not ready for vector store operations')

    expect(indexStoreCtorMock).not.toHaveBeenCalled()
  })

  it('logs an error when an empty index mounts under a base with completed items', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    hasAnyMaterialMock.mockResolvedValueOnce(false)
    getItemsByBaseIdMock.mockResolvedValueOnce([
      { id: 'item-1', type: 'directory', status: 'completed' },
      { id: 'item-2', type: 'file', status: 'completed' }
    ])

    const store = await service.getIndexStore(base)

    expect(store).toBe(lastStore())
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('zero materials while the base has completed items'),
      expect.objectContaining({ baseId: base.id })
    )
  })

  it('stays quiet when an empty index mounts under a base with no completed indexable items', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    hasAnyMaterialMock.mockResolvedValueOnce(false)
    // A completed empty directory is legitimate without materials; in-flight leaves are too.
    getItemsByBaseIdMock.mockResolvedValueOnce([
      { id: 'item-1', type: 'directory', status: 'completed' },
      { id: 'item-2', type: 'file', status: 'processing' }
    ])

    await service.getIndexStore(base)

    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('fails the open and closes the driver when the empty-index diagnostic cannot read the base items', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    let openedDriver: { close: ReturnType<typeof vi.fn> } | undefined
    openDriverMock.mockImplementationOnce(async () => {
      openedDriver = { kind: 'driver', close: vi.fn().mockResolvedValue(undefined) } as never
      return openedDriver
    })
    hasAnyMaterialMock.mockResolvedValueOnce(false)
    getItemsByBaseIdMock.mockRejectedValueOnce(new Error('app database unavailable'))

    // Deliberate fail-loud: swallowing the lookup failure would re-silence the
    // deleted-base race (open racing deleteBase recreates an empty file, and the
    // lookup's NOT_FOUND is what makes that loud instead of caching an empty store).
    await expect(service.getIndexStore(base)).rejects.toThrow('app database unavailable')

    expect(openedDriver?.close).toHaveBeenCalledTimes(1)
    expect(indexStoreCtorMock).not.toHaveBeenCalled()
  })
})
