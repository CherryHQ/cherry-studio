import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getStoreIfExistsMock, replaceByExternalIdMock } = vi.hoisted(() => ({
  getStoreIfExistsMock: vi.fn(),
  replaceByExternalIdMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeVectorStoreService: {
      getStoreIfExists: getStoreIfExistsMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

const { deleteKnowledgeItemVectors } = await import('../vectorCleanup')

function createBase(): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    groupId: null,
    emoji: '📁',
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
    searchMode: 'default',
    hybridAlpha: undefined,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('deleteKnowledgeItemVectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getStoreIfExistsMock.mockResolvedValue({ replaceByExternalId: replaceByExternalIdMock })
    replaceByExternalIdMock.mockResolvedValue([])
  })

  it('skips cleanup when no vector store exists', async () => {
    getStoreIfExistsMock.mockResolvedValueOnce(null)

    await deleteKnowledgeItemVectors(createBase(), ['note-1'])

    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
  })

  it('deduplicates item ids before deleting vectors', async () => {
    await deleteKnowledgeItemVectors(createBase(), ['note-1', 'note-1', 'note-2'])

    expect(replaceByExternalIdMock).toHaveBeenCalledTimes(2)
    expect(replaceByExternalIdMock).toHaveBeenCalledWith('note-1', [])
    expect(replaceByExternalIdMock).toHaveBeenCalledWith('note-2', [])
  })

  it('attempts every vector cleanup before reporting failed item ids', async () => {
    replaceByExternalIdMock
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('note-2 failed'))
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('note-4 failed'))

    await expect(deleteKnowledgeItemVectors(createBase(), ['note-1', 'note-2', 'note-3', 'note-4'])).rejects.toThrow(
      'note-2, note-4'
    )

    expect(replaceByExternalIdMock).toHaveBeenCalledTimes(4)
  })
})
