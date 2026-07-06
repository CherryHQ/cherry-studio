import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getIndexStoreIfExistsMock,
  deleteMaterialsMock,
  reclaimSpaceMock,
  loggerWarnMock,
  loggerErrorMock,
  loggerInfoMock
} = vi.hoisted(() => ({
  getIndexStoreIfExistsMock: vi.fn(),
  deleteMaterialsMock: vi.fn(),
  reclaimSpaceMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerInfoMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeVectorStoreService: {
      getIndexStoreIfExists: getIndexStoreIfExistsMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: loggerInfoMock, warn: loggerWarnMock, error: loggerErrorMock, debug: vi.fn() })
  }
}))

const { deleteKnowledgeItemVectors, reclaimKnowledgeIndexSpace } = await import('../vectorCleanup')

function createBase(): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    groupId: null,
    dimensions: 3,
    embeddingModelId: 'provider::embed',
    rerankModelId: null,
    fileProcessorId: null,
    status: 'completed',
    error: null,
    chunkSize: 1024,
    chunkOverlap: 200,
    chunkStrategy: 'structured',
    chunkSeparator: '\\n\\n',
    threshold: undefined,
    documentCount: 10,
    searchMode: 'vector',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('deleteKnowledgeItemVectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getIndexStoreIfExistsMock.mockResolvedValue({
      deleteMaterials: deleteMaterialsMock,
      reclaimSpace: reclaimSpaceMock
    })
    deleteMaterialsMock.mockResolvedValue(undefined)
    reclaimSpaceMock.mockResolvedValue({ vacuumed: false, reclaimedBytes: 0 })
  })

  it('skips cleanup when no vector store exists', async () => {
    getIndexStoreIfExistsMock.mockResolvedValueOnce(undefined)

    await deleteKnowledgeItemVectors(createBase(), ['note-1'])

    expect(deleteMaterialsMock).not.toHaveBeenCalled()
  })

  it('deletes all deduplicated item ids in a single batch call', async () => {
    // The whole folder's ids go to deleteMaterials in ONE call (one transaction, one GC
    // pass) — not one call per id, which was the O(N × table) folder-delete freeze.
    await deleteKnowledgeItemVectors(createBase(), ['note-1', 'note-1', 'note-2'])

    expect(deleteMaterialsMock).toHaveBeenCalledTimes(1)
    expect(deleteMaterialsMock).toHaveBeenCalledWith(['note-1', 'note-2'])
  })

  it('propagates the error when the batch delete fails', async () => {
    // The batch is atomic: a failure rolls the whole transaction back and throws its root
    // cause, so a retry re-discovers every affected id. No per-item aggregation to do.
    deleteMaterialsMock.mockRejectedValueOnce(new Error('batch delete failed'))

    await expect(deleteKnowledgeItemVectors(createBase(), ['note-1', 'note-2'])).rejects.toThrow('batch delete failed')
  })
})

describe('reclaimKnowledgeIndexSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getIndexStoreIfExistsMock.mockResolvedValue({
      deleteMaterials: deleteMaterialsMock,
      reclaimSpace: reclaimSpaceMock
    })
    reclaimSpaceMock.mockResolvedValue({ vacuumed: true, reclaimedBytes: 1024 })
  })

  it('skips reclaim when no vector store exists', async () => {
    getIndexStoreIfExistsMock.mockResolvedValueOnce(undefined)

    await reclaimKnowledgeIndexSpace(createBase())

    expect(reclaimSpaceMock).not.toHaveBeenCalled()
  })

  it('reclaims the index space when a store exists', async () => {
    await reclaimKnowledgeIndexSpace(createBase())

    expect(reclaimSpaceMock).toHaveBeenCalledTimes(1)
  })

  it('never throws when reclaim fails — the delete already succeeded', async () => {
    // Best-effort: a transient reclaim failure must not fail the delete job whose rows
    // and vectors are already gone; the freed pages just wait for a later index to reuse.
    reclaimSpaceMock.mockRejectedValueOnce(new Error('database is locked'))

    await expect(reclaimKnowledgeIndexSpace(createBase())).resolves.toBeUndefined()
    // A transient failure stays a warn — not the corruption-class error path.
    expect(loggerWarnMock).toHaveBeenCalledTimes(1)
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('logs a corruption-class reclaim failure at error (still swallowed) so a damaged index is triaged', async () => {
    // reclaim's whole-file checkpoint/optimize/VACUUM is often the first op to touch the full file
    // post-delete, so SQLITE_CORRUPT/SQLITE_NOTADB surfaces here — it must be loud, not buried in the
    // benign "failed to reclaim" warn, yet still swallowed (the delete already succeeded).
    reclaimSpaceMock.mockRejectedValueOnce(
      Object.assign(new Error('database disk image is malformed'), { code: 'SQLITE_CORRUPT' })
    )

    await expect(reclaimKnowledgeIndexSpace(createBase())).resolves.toBeUndefined()
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Knowledge index appears corrupt during post-delete reclaim',
      expect.any(Error),
      { baseId: 'kb-1' }
    )
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  it('never throws when the index store fails to open — the delete already succeeded', async () => {
    // The open itself can throw (corrupt index, readiness/base_id mismatch, schema open failure).
    // It is inside the same best-effort try, so an open failure must not fail the delete job whose
    // rows and vectors are already gone.
    getIndexStoreIfExistsMock.mockRejectedValueOnce(new Error('index store failed to open'))

    await expect(reclaimKnowledgeIndexSpace(createBase())).resolves.toBeUndefined()
    expect(reclaimSpaceMock).not.toHaveBeenCalled()
  })
})
