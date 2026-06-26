import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getIndexStoreIfExistsMock, deleteMaterialsMock, reclaimSpaceMock } = vi.hoisted(() => ({
  getIndexStoreIfExistsMock: vi.fn(),
  deleteMaterialsMock: vi.fn(),
  reclaimSpaceMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeVectorStoreService: {
      getIndexStoreIfExists: getIndexStoreIfExistsMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

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
  })
})
