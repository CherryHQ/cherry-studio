import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'
import { Document, TextNode } from '@vectorstores/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readerFactoryMock = vi.hoisted(() => ({
  create: vi.fn()
}))

const documentEmbedderMock = vi.hoisted(() => ({
  embed: vi.fn()
}))

const embeddingModelFactoryMock = vi.hoisted(() => ({
  create: vi.fn()
}))

const vectorStoreFactoryMock = vi.hoisted(() => ({
  createBase: vi.fn()
}))

const knowledgeBaseServiceMock = vi.hoisted(() => ({
  getById: vi.fn()
}))

const knowledgeItemServiceMock = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn()
}))

vi.mock('@main/data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: knowledgeBaseServiceMock
}))

vi.mock('@main/data/services/KnowledgeItemService', () => ({
  knowledgeItemService: knowledgeItemServiceMock
}))

vi.mock('../readers/ReaderFactory', () => ({
  ReaderFactory: readerFactoryMock
}))

vi.mock('../embedding/EmbeddingModelFactory', () => ({
  EmbeddingModelFactory: embeddingModelFactoryMock
}))

vi.mock('../vectorstore/VectorStoreFactory', () => ({
  VectorStoreFactory: vectorStoreFactoryMock
}))

vi.mock('../embedding/DocumentEmbedder', () => ({
  DocumentEmbedder: documentEmbedderMock
}))

vi.mock('@vectorstores/libsql', () => ({
  LibSQLVectorStore: class {}
}))

import { KnowledgeExecutionService } from '../KnowledgeExecutionService'

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

function createItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: 'item-1',
    baseId: 'base-1',
    groupId: null,
    type: 'note',
    status: 'idle',
    error: null,
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T00:00:00.000Z',
    data: {
      content: 'hello world',
      sourceUrl: 'https://example.com/note'
    },
    ...overrides
  } as KnowledgeItem
}

describe('KnowledgeExecutionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches execute() to embed for embed stage', async () => {
    const service = new KnowledgeExecutionService()
    const embedSpy = vi.spyOn(service, 'embed').mockResolvedValue({ type: 'completed' })

    const task = {
      itemId: 'item-1',
      baseId: 'base-1',
      stage: 'embed' as const,
      readyAt: Date.now()
    }

    const result = await service.execute(task)

    expect(result).toEqual({ type: 'completed' })
    expect(embedSpy).toHaveBeenCalledWith(task)
  })

  it('dispatches execute() to submitFileProcessing for file_processing_submit stage', async () => {
    const service = new KnowledgeExecutionService()
    const submitSpy = vi.spyOn(service, 'submitFileProcessing').mockResolvedValue({ type: 'completed' })

    const task = {
      itemId: 'item-1',
      baseId: 'base-1',
      stage: 'file_processing_submit' as const,
      readyAt: Date.now()
    }

    const result = await service.execute(task)

    expect(result).toEqual({ type: 'completed' })
    expect(submitSpy).toHaveBeenCalledWith(task)
  })

  it('dispatches execute() to pollFileProcessing for file_processing_poll stage', async () => {
    const service = new KnowledgeExecutionService()
    const pollSpy = vi.spyOn(service, 'pollFileProcessing').mockResolvedValue({ type: 'completed' })

    const task = {
      itemId: 'item-1',
      baseId: 'base-1',
      stage: 'file_processing_poll' as const,
      readyAt: Date.now()
    }

    const result = await service.execute(task)

    expect(result).toEqual({ type: 'completed' })
    expect(pollSpy).toHaveBeenCalledWith(task)
  })

  it('completes the minimal embed flow for a knowledge item', async () => {
    const base = createBase()
    const item = createItem()
    const sourceDocuments = [
      new Document({
        text: 'hello world',
        metadata: {
          sourceUrl: 'https://example.com/note'
        }
      })
    ]
    const chunks = [
      new Document({
        text: 'hello chunk',
        metadata: {
          itemId: item.id,
          chunkIndex: 0
        }
      })
    ]
    const nodes = [
      new TextNode({
        text: 'hello chunk',
        embedding: [0.1, 0.2],
        metadata: {
          itemId: item.id,
          chunkIndex: 0
        }
      })
    ]

    knowledgeBaseServiceMock.getById.mockResolvedValue(base)
    knowledgeItemServiceMock.getById.mockResolvedValue(item)
    knowledgeItemServiceMock.update.mockResolvedValue(item)
    const load = vi.fn(async () => sourceDocuments)
    readerFactoryMock.create.mockReturnValue({ load })
    const embeddingModel = { modelId: 'nomic-embed-text' }
    embeddingModelFactoryMock.create.mockReturnValue(embeddingModel)
    documentEmbedderMock.embed.mockResolvedValue(nodes)
    const add = vi.fn(async () => ['node-1'])
    vectorStoreFactoryMock.createBase.mockResolvedValue({ add })

    const service = new KnowledgeExecutionService()

    const result = await service.embed({
      itemId: item.id,
      baseId: base.id,
      stage: 'embed',
      readyAt: Date.now()
    })

    expect(result).toEqual({ type: 'completed' })
    expect(knowledgeBaseServiceMock.getById).toHaveBeenCalledWith(base.id)
    expect(knowledgeItemServiceMock.getById).toHaveBeenCalledWith(item.id)
    expect(knowledgeItemServiceMock.update).toHaveBeenNthCalledWith(1, item.id, {
      status: 'embed',
      error: null
    })
    expect(readerFactoryMock.create).toHaveBeenCalledWith(item)
    expect(load).toHaveBeenCalledWith(item)
    expect(embeddingModelFactoryMock.create).toHaveBeenCalledWith(base)
    expect(documentEmbedderMock.embed).toHaveBeenCalledWith(embeddingModel, chunks)
    expect(vectorStoreFactoryMock.createBase).toHaveBeenCalledWith(base)
    expect(add).toHaveBeenCalledWith(nodes)
    expect(knowledgeItemServiceMock.update).toHaveBeenNthCalledWith(2, item.id, {
      status: 'completed',
      error: null
    })
  })

  it('marks the item as failed when embed execution throws', async () => {
    const base = createBase()
    const item = createItem()
    const loadError = new Error('reader failed')

    knowledgeBaseServiceMock.getById.mockResolvedValue(base)
    knowledgeItemServiceMock.getById.mockResolvedValue(item)
    knowledgeItemServiceMock.update.mockResolvedValue(item)
    const load = vi.fn(async () => {
      throw loadError
    })
    readerFactoryMock.create.mockReturnValue({ load })
    embeddingModelFactoryMock.create.mockReset()
    documentEmbedderMock.embed.mockReset()
    vectorStoreFactoryMock.createBase.mockReset()

    const service = new KnowledgeExecutionService()

    const result = await service.embed({
      itemId: item.id,
      baseId: base.id,
      stage: 'embed',
      readyAt: Date.now()
    })

    expect(result).toEqual({
      type: 'failed',
      error: 'reader failed'
    })
    expect(knowledgeItemServiceMock.update).toHaveBeenNthCalledWith(1, item.id, {
      status: 'embed',
      error: null
    })
    expect(knowledgeItemServiceMock.update).toHaveBeenNthCalledWith(2, item.id, {
      status: 'failed',
      error: 'reader failed'
    })
    expect(vectorStoreFactoryMock.createBase).not.toHaveBeenCalled()
  })

  it('returns failed from submitFileProcessing skeleton and marks file_processing then failed', async () => {
    const item = createItem()
    knowledgeItemServiceMock.getById.mockResolvedValue(item)
    knowledgeItemServiceMock.update.mockResolvedValue(item)

    const service = new KnowledgeExecutionService()
    const result = await service.submitFileProcessing({
      itemId: item.id,
      baseId: item.baseId,
      stage: 'file_processing_submit',
      readyAt: Date.now()
    })

    expect(result).toEqual({
      type: 'failed',
      error: 'submitFileProcessing is not implemented yet'
    })
    expect(knowledgeItemServiceMock.update).toHaveBeenNthCalledWith(1, item.id, {
      status: 'file_processing',
      error: null
    })
    expect(knowledgeItemServiceMock.update).toHaveBeenNthCalledWith(2, item.id, {
      status: 'failed',
      error: 'submitFileProcessing is not implemented yet'
    })
  })

  it('returns failed from pollFileProcessing skeleton and marks file_processing then failed', async () => {
    const item = createItem()
    knowledgeItemServiceMock.getById.mockResolvedValue(item)
    knowledgeItemServiceMock.update.mockResolvedValue(item)

    const service = new KnowledgeExecutionService()
    const result = await service.pollFileProcessing({
      itemId: item.id,
      baseId: item.baseId,
      stage: 'file_processing_poll',
      readyAt: Date.now()
    })

    expect(result).toEqual({
      type: 'failed',
      error: 'pollFileProcessing is not implemented yet'
    })
    expect(knowledgeItemServiceMock.update).toHaveBeenNthCalledWith(1, item.id, {
      status: 'file_processing',
      error: null
    })
    expect(knowledgeItemServiceMock.update).toHaveBeenNthCalledWith(2, item.id, {
      status: 'failed',
      error: 'pollFileProcessing is not implemented yet'
    })
  })
})
