import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeBaseServiceMock = vi.hoisted(() => ({
  getById: vi.fn()
}))

const vectorStoreFactoryMock = vi.hoisted(() => ({
  createBase: vi.fn()
}))

vi.mock('@main/data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: knowledgeBaseServiceMock
}))

vi.mock('../vectorstore/VectorStoreFactory', () => ({
  VectorStoreFactory: vectorStoreFactoryMock
}))

import { BaseService } from '@main/core/lifecycle'

import { KnowledgeVectorService } from '../KnowledgeVectorService'

function createBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'base-1',
    name: 'Base',
    description: 'Knowledge base',
    dimensions: 768,
    embeddingModelId: 'ollama::nomic-embed-text',
    rerankModelId: undefined,
    fileProcessorId: undefined,
    chunkSize: 256,
    chunkOverlap: 32,
    threshold: undefined,
    documentCount: undefined,
    searchMode: undefined,
    hybridAlpha: undefined,
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T00:00:00.000Z',
    ...overrides
  }
}

describe('KnowledgeVectorService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
  })

  it('returns early when itemIds are empty after filtering', async () => {
    const service = new KnowledgeVectorService()

    await service.deleteItems('base-1', ['', '   '])

    expect(knowledgeBaseServiceMock.getById).not.toHaveBeenCalled()
    expect(vectorStoreFactoryMock.createBase).not.toHaveBeenCalled()
  })

  it('loads the base and deletes deduplicated item vectors sequentially', async () => {
    const base = createBase()
    const callOrder: string[] = []
    const deleteMock = vi.fn(async (itemId: string) => {
      callOrder.push(`start:${itemId}`)
      await Promise.resolve()
      callOrder.push(`end:${itemId}`)
    })

    knowledgeBaseServiceMock.getById.mockResolvedValue(base)
    vectorStoreFactoryMock.createBase.mockResolvedValue({
      delete: deleteMock
    })

    const service = new KnowledgeVectorService()

    await service.deleteItems(base.id, ['item-1', ' ', 'item-2', 'item-1'])

    expect(knowledgeBaseServiceMock.getById).toHaveBeenCalledWith(base.id)
    expect(vectorStoreFactoryMock.createBase).toHaveBeenCalledWith(base)
    expect(deleteMock).toHaveBeenNthCalledWith(1, 'item-1')
    expect(deleteMock).toHaveBeenNthCalledWith(2, 'item-2')
    expect(deleteMock).toHaveBeenCalledTimes(2)
    expect(callOrder).toEqual(['start:item-1', 'end:item-1', 'start:item-2', 'end:item-2'])
  })
})
