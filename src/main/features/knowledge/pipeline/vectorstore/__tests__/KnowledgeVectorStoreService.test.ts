import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type * as LifecycleModule from '@main/core/lifecycle'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  type KnowledgeBase
} from '@shared/data/types/knowledge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  loggerDebugMock,
  loggerErrorMock,
  loggerInfoMock,
  loggerWarnMock,
  getItemsByBaseIdMock,
  getPathSyncMock,
  deleteDirMock
} = vi.hoisted(() => ({
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  getItemsByBaseIdMock: vi.fn(),
  getPathSyncMock: vi.fn(),
  deleteDirMock: vi.fn()
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

// The app-DB boundary: everything under indexStore/ (driver, schema, meta, store) runs
// for real against a temp-dir SQLite file, so these tests exercise the real DDL/meta
// contract instead of pinning mock call shapes. `pathStorage`'s path resolver is
// redirected into the temp dir; `deleteKnowledgeBaseDir` stays mocked (its own removeDir
// behavior is covered by pathStorage's own tests).
vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: { getItemsByBaseId: getItemsByBaseIdMock }
}))

vi.mock('../../../pathStorage', () => ({
  getKnowledgeVectorStoreFilePathSync: getPathSyncMock,
  deleteKnowledgeBaseDir: deleteDirMock
}))

const { KnowledgeVectorStoreService } = await import('../KnowledgeVectorStoreService')
const { KnowledgeIndexStore } = await import('../indexStore/KnowledgeIndexStore')
const { BetterSqlite3Driver, openBetterSqlite3IndexDriver } = await import('../indexStore/BetterSqlite3Driver')
const schemaModule = await import('../indexStore/schema')
const indexMetaModule = await import('../indexStore/indexMeta')
const { KNOWLEDGE_INDEX_SCHEMA_VERSION } = schemaModule

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
    chunkStrategy: 'structured',
    chunkSeparator: '\\n\\n',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createFailedBase(): KnowledgeBase {
  return {
    ...createBase(),
    dimensions: null,
    embeddingModelId: null,
    status: 'failed',
    error: 'missing_embedding_model'
  }
}

/** Opens (and immediately closes) a store for `base` so its file exists on disk at the current schema version. */
function primeStoreOnDisk(base: KnowledgeBase): void {
  const store = new KnowledgeVectorStoreService().getIndexStore(base)
  store.close()
}

/** Opens a fresh raw driver directly on `base`'s file (bypassing the service/cache) to inspect or mutate it. */
function withRawDriver<T>(base: KnowledgeBase, fn: (driver: InstanceType<typeof BetterSqlite3Driver>) => T): T {
  const driver = openBetterSqlite3IndexDriver(getPathSyncMock(base.id))
  try {
    return fn(driver)
  } finally {
    driver.close()
  }
}

describe('KnowledgeVectorStoreService', () => {
  let tempDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-vsstore-'))
    getPathSyncMock.mockImplementation((baseId: string) => join(tempDir, `${baseId}.sqlite`))
    getItemsByBaseIdMock.mockReturnValue([])
    deleteDirMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('opens an index store on first request and caches it per base', () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()

    const first = service.getIndexStore(base)
    const second = service.getIndexStore(base)

    expect(first).toBe(second)
    expect(first).toBeInstanceOf(KnowledgeIndexStore)
    expect(loggerInfoMock).toHaveBeenCalledWith('Opened knowledge index store', { baseId: base.id, cacheSize: 1 })
    expect(loggerDebugMock).toHaveBeenCalledWith('Reusing cached knowledge index store', { baseId: base.id })
  })

  it('synchronous open makes a second call observe the already-cached store', () => {
    // Opening a store (better-sqlite3 connect + schema + meta) is fully synchronous, so
    // the first call's cache write completes before the second call runs — there is no
    // in-flight state the second call could observe mid-open. Pinned via a call-count
    // assertion so a future refactor that reintroduces an async open cannot silently
    // double-open.
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    const createSchemaSpy = vi.spyOn(schemaModule, 'createKnowledgeIndexSchema')

    const first = service.getIndexStore(base)
    const second = service.getIndexStore(base)

    expect(first).toBe(second)
    expect(createSchemaSpy).toHaveBeenCalledTimes(1)
  })

  it('evicts a failed open so a later call retries instead of re-throwing the failure', () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    // A regular file where the index dir must go makes the real mkdirSync in
    // openBetterSqlite3IndexDriver fail with ENOTDIR before any Database is opened.
    const blockerPath = join(tempDir, 'blocked-open')
    writeFileSync(blockerPath, 'not a directory')
    getPathSyncMock.mockReturnValueOnce(join(blockerPath, 'index.sqlite'))

    expect(() => service.getIndexStore(base)).toThrow()

    const store = service.getIndexStore(base)
    expect(store).toBeInstanceOf(KnowledgeIndexStore)
  })

  it('stamps and verifies the meta identity row before handing out the store', () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    const ensureIndexMetaSpy = vi.spyOn(indexMetaModule, 'ensureIndexMeta')

    service.getIndexStore(base)

    expect(ensureIndexMetaSpy).toHaveBeenCalledTimes(1)
    expect(ensureIndexMetaSpy).toHaveBeenCalledWith(expect.anything(), { baseId: base.id })
  })

  it('creates the schema normally when the stored version matches (no rebuild)', () => {
    const base = createBase()
    primeStoreOnDisk(base)
    const createSchemaSpy = vi.spyOn(schemaModule, 'createKnowledgeIndexSchema')
    const resetSchemaSpy = vi.spyOn(schemaModule, 'resetKnowledgeIndexSchema')
    const service = new KnowledgeVectorStoreService()

    service.getIndexStore(base)

    expect(createSchemaSpy).toHaveBeenCalledTimes(1)
    expect(resetSchemaSpy).not.toHaveBeenCalled()
  })

  it('rebuilds the derived index when an existing index.sqlite is at a stale schema version', () => {
    const base = createBase()
    primeStoreOnDisk(base)
    // Leave a marker row and stamp a stale version directly, so the rebuild below is
    // verified against real DDL (dropped tables), not a mocked branch decision.
    withRawDriver(base, (driver) => {
      driver.execute('INSERT INTO content (content_hash, text, created_at) VALUES (?, ?, ?)', ['marker', 'x', 0])
      driver.execute('UPDATE meta SET schema_version = ?', [KNOWLEDGE_INDEX_SCHEMA_VERSION - 1])
    })
    const createSchemaSpy = vi.spyOn(schemaModule, 'createKnowledgeIndexSchema')
    const resetSchemaSpy = vi.spyOn(schemaModule, 'resetKnowledgeIndexSchema')
    const ensureIndexMetaSpy = vi.spyOn(indexMetaModule, 'ensureIndexMeta')
    const service = new KnowledgeVectorStoreService()

    service.getIndexStore(base)

    // Drop+recreate via resetKnowledgeIndexSchema, NOT the plain create — an old layout
    // (e.g. pre-fts_rowid) cannot be retrofitted by CREATE ... IF NOT EXISTS.
    expect(resetSchemaSpy).toHaveBeenCalledTimes(1)
    expect(createSchemaSpy).not.toHaveBeenCalled()
    // Warn so the wipe-and-reindex is diagnosable.
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Knowledge index schema version mismatch — rebuilding the derived index',
      expect.objectContaining({
        baseId: base.id,
        storedVersion: KNOWLEDGE_INDEX_SCHEMA_VERSION - 1,
        expectedVersion: KNOWLEDGE_INDEX_SCHEMA_VERSION
      })
    )
    // The reset drops meta, so the open path still restamps it afterwards.
    expect(ensureIndexMetaSpy).toHaveBeenCalledTimes(1)
    // The rebuild really dropped and recreated the schema: the marker inserted before
    // the stale-version stamp is gone, and the restamped version is current.
    expect(
      withRawDriver(base, (driver) => driver.execute('SELECT 1 FROM content WHERE content_hash = ?', ['marker']).rows)
    ).toEqual([])
    expect(withRawDriver(base, (driver) => indexMetaModule.readIndexSchemaVersion(driver))).toBe(
      KNOWLEDGE_INDEX_SCHEMA_VERSION
    )
  })

  it('also rebuilds when the stored version is NEWER than this build (downgrade)', () => {
    // The guard is `!==`, not `<` — a file written by a newer build (user downgraded the app) is
    // just as incompatible a layout and must be rebuilt, not opened as-is. Pins that semantics so a
    // future refactor to `<` does not silently start mounting newer files.
    const base = createBase()
    primeStoreOnDisk(base)
    withRawDriver(base, (driver) => {
      driver.execute('UPDATE meta SET schema_version = ?', [KNOWLEDGE_INDEX_SCHEMA_VERSION + 1])
    })
    const createSchemaSpy = vi.spyOn(schemaModule, 'createKnowledgeIndexSchema')
    const resetSchemaSpy = vi.spyOn(schemaModule, 'resetKnowledgeIndexSchema')
    const service = new KnowledgeVectorStoreService()

    service.getIndexStore(base)

    expect(resetSchemaSpy).toHaveBeenCalledTimes(1)
    expect(createSchemaSpy).not.toHaveBeenCalled()
  })

  it('closes the driver and aborts the open when meta verification fails (wrong/corrupt base)', () => {
    const base = createBase('kb-shared')
    const otherBase = createBase('kb-other')
    // Both bases resolve to the same on-disk file, so the second open's meta
    // identity check genuinely finds a mismatched base_id.
    getPathSyncMock.mockImplementation(() => join(tempDir, 'shared.sqlite'))
    primeStoreOnDisk(base)
    const closeSpy = vi.spyOn(BetterSqlite3Driver.prototype, 'close')
    const service = new KnowledgeVectorStoreService()

    expect(() => service.getIndexStore(otherBase)).toThrow('belongs to a different base')

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('closes the driver when schema creation fails so the file handle is not leaked', () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    const closeSpy = vi.spyOn(BetterSqlite3Driver.prototype, 'close')
    vi.spyOn(schemaModule, 'createKnowledgeIndexSchema').mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    expect(() => service.getIndexStore(base)).toThrow('disk full')

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('returns undefined from getIndexStoreIfExists when no backing file exists', () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()

    expect(service.getIndexStoreIfExists(base)).toBeUndefined()

    expect(loggerDebugMock).toHaveBeenCalledWith('Knowledge index store does not exist on disk', { baseId: base.id })
  })

  it('opens an existing store from disk when getIndexStoreIfExists detects a backing file', () => {
    const base = createBase()
    primeStoreOnDisk(base)
    const service = new KnowledgeVectorStoreService()

    const store = service.getIndexStoreIfExists(base)

    expect(store).toBeInstanceOf(KnowledgeIndexStore)
  })

  it('returns the cached store from getIndexStoreIfExists without probing disk', () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    const created = service.getIndexStore(base)
    getPathSyncMock.mockClear()

    expect(service.getIndexStoreIfExists(base)).toBe(created)
    // storeFileExists resolves the store path before stat-ing it, so an
    // untouched path resolver proves the disk probe never ran.
    expect(getPathSyncMock).not.toHaveBeenCalled()
  })

  it('closes the cached store and removes the base directory on deleteStore', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    const closeSpy = vi.spyOn(BetterSqlite3Driver.prototype, 'close')

    const store = service.getIndexStore(base)
    await service.deleteStore(base.id)

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(deleteDirMock).toHaveBeenCalledWith(base.id)
    // Close must precede directory removal — on Windows a still-open sqlite
    // handle makes the directory deletion fail.
    expect(closeSpy.mock.invocationCallOrder[0]).toBeLessThan(deleteDirMock.mock.invocationCallOrder[0])

    // Cache was evicted: the next open builds a fresh instance.
    const reopened = service.getIndexStore(base)
    expect(reopened).not.toBe(store)
  })

  it('deleteStore removes the directory even when no store was ever opened for the base', async () => {
    // Opening a store (see openIndexStore) is fully synchronous — it either completes and
    // caches a store, or throws before caching anything. There is no in-flight state
    // deleteStore could observe mid-open, so this covers the "nothing cached" case:
    // deleteStore must still close-if-present (a no-op here) and remove the directory.
    const service = new KnowledgeVectorStoreService()
    const base = createBase()

    await service.deleteStore(base.id)

    expect(deleteDirMock).toHaveBeenCalledWith(base.id)
  })

  it('evicts the cached store even when directory removal fails', async () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    deleteDirMock.mockRejectedValueOnce(new Error('delete failed'))

    const store = service.getIndexStore(base)
    await expect(service.deleteStore(base.id)).rejects.toThrow('delete failed')

    const reopened = service.getIndexStore(base)
    expect(reopened).not.toBe(store)
  })

  it('closes all cached stores during stop and continues when one close throws', async () => {
    const service = new KnowledgeVectorStoreService()

    const first = service.getIndexStore(createBase('kb-1'))
    const second = service.getIndexStore(createBase('kb-2'))
    const closeError = new Error('close failed')
    const firstCloseSpy = vi.spyOn(first, 'close').mockImplementationOnce(() => {
      throw closeError
    })
    const secondCloseSpy = vi.spyOn(second, 'close')

    await expect((service as unknown as { onStop: () => Promise<void> }).onStop()).resolves.toBeUndefined()

    expect(firstCloseSpy).toHaveBeenCalledTimes(1)
    expect(secondCloseSpy).toHaveBeenCalledTimes(1)
    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to close knowledge index store', closeError, {
      baseId: 'kb-1'
    })
    expect(loggerInfoMock).toHaveBeenCalledWith('Stopping knowledge index stores', { storeCount: 2 })
    expect(loggerInfoMock).toHaveBeenCalledWith('Stopped knowledge index stores', { storeCount: 2 })

    // Cache cleared: reopening kb-2 builds a fresh instance.
    const reopened = service.getIndexStore(createBase('kb-2'))
    expect(reopened).not.toBe(second)
  })

  it('rejects bases that are not ready before touching disk', () => {
    const service = new KnowledgeVectorStoreService()
    const base = createFailedBase()

    expect(() => service.getIndexStore(base)).toThrow('not ready for vector store operations')

    // The readiness assert throws before openIndexStore ever resolves the store path.
    expect(getPathSyncMock).not.toHaveBeenCalled()
  })

  it('lets cleanup on a failed base proceed: getIndexStoreIfExists returns undefined instead of asserting', () => {
    // Failed bases never get a store file (the vector migrator skips them and
    // getIndexStore asserts), so the existence probe is the path cleanup takes.
    const service = new KnowledgeVectorStoreService()
    const base = createFailedBase()

    expect(service.getIndexStoreIfExists(base)).toBeUndefined()
  })

  it('still asserts readiness when a failed base unexpectedly has a store file on disk', () => {
    const service = new KnowledgeVectorStoreService()
    const base = createFailedBase()
    writeFileSync(getPathSyncMock(base.id), '')

    expect(() => service.getIndexStoreIfExists(base)).toThrow('not ready for vector store operations')
  })

  it('logs an error when an empty index mounts under a base with completed items', () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    getItemsByBaseIdMock.mockReturnValueOnce([
      { id: 'item-1', type: 'directory', status: 'completed' },
      { id: 'item-2', type: 'file', status: 'completed' }
    ])

    const store = service.getIndexStore(base)

    expect(store).toBeInstanceOf(KnowledgeIndexStore)
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('zero materials while the base has completed items'),
      expect.objectContaining({ baseId: base.id })
    )
  })

  it('stays quiet when an empty index mounts under a base with no completed indexable items', () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    // A completed empty directory is legitimate without materials; in-flight leaves are too.
    getItemsByBaseIdMock.mockReturnValueOnce([
      { id: 'item-1', type: 'directory', status: 'completed' },
      { id: 'item-2', type: 'file', status: 'processing' }
    ])

    service.getIndexStore(base)

    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('fails the open and closes the driver when the empty-index diagnostic cannot read the base items', () => {
    const service = new KnowledgeVectorStoreService()
    const base = createBase()
    const closeSpy = vi.spyOn(BetterSqlite3Driver.prototype, 'close')
    getItemsByBaseIdMock.mockImplementationOnce(() => {
      throw new Error('app database unavailable')
    })

    // Deliberate fail-loud: swallowing the lookup failure would re-silence the
    // deleted-base race (open racing deleteBase recreates an empty file, and the
    // lookup's NOT_FOUND is what makes that loud instead of caching an empty store).
    expect(() => service.getIndexStore(base)).toThrow('app database unavailable')

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })
})
