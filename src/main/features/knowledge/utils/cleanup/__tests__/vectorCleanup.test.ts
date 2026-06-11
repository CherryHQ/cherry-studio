import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getIndexStoreIfExistsMock, deleteMaterialMock } = vi.hoisted(() => ({
  getIndexStoreIfExistsMock: vi.fn(),
  deleteMaterialMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeVectorStoreService: {
      getIndexStoreIfExists: getIndexStoreIfExistsMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

const { deleteKnowledgeItemVectors } = await import('../vectorCleanup')

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
    getIndexStoreIfExistsMock.mockResolvedValue({ deleteMaterial: deleteMaterialMock })
    deleteMaterialMock.mockResolvedValue(undefined)
  })

  it('skips cleanup when no vector store exists', async () => {
    getIndexStoreIfExistsMock.mockResolvedValueOnce(undefined)

    await deleteKnowledgeItemVectors(createBase(), ['note-1'])

    expect(deleteMaterialMock).not.toHaveBeenCalled()
  })

  it('deduplicates item ids before deleting vectors', async () => {
    await deleteKnowledgeItemVectors(createBase(), ['note-1', 'note-1', 'note-2'])

    expect(deleteMaterialMock).toHaveBeenCalledTimes(2)
    expect(deleteMaterialMock).toHaveBeenCalledWith('note-1')
    expect(deleteMaterialMock).toHaveBeenCalledWith('note-2')
  })

  it('attempts every vector cleanup before reporting failed item ids with their root causes', async () => {
    deleteMaterialMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('note-2 failed'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('note-4 failed'))

    // Each failed id carries its own reason — an id-only list would leave the
    // aggregate error with nothing to diagnose the individual deletions.
    await expect(deleteKnowledgeItemVectors(createBase(), ['note-1', 'note-2', 'note-3', 'note-4'])).rejects.toThrow(
      'note-2 (note-2 failed), note-4 (note-4 failed)'
    )

    expect(deleteMaterialMock).toHaveBeenCalledTimes(4)
  })
})
