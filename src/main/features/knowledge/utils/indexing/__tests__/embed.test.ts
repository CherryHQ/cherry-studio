import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { Document, NodeRelationship } from '@vectorstores/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  aiEmbedManyMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiService: {
      embedMany: mocks.aiEmbedManyMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

const { embedKnowledgeDocuments, embedKnowledgeQuery } = await import('../embed')

const KNOWLEDGE_BASE_ID = '11111111-1111-4111-8111-111111111111'
const KNOWLEDGE_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'

function createBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: KNOWLEDGE_BASE_ID,
    name: 'KB',
    groupId: null,
    dimensions: 3,
    embeddingModelId: 'provider::embed',
    rerankModelId: null,
    fileProcessorId: null,
    status: 'completed',
    error: null,
    chunkSize: 1000,
    chunkOverlap: 0,
    threshold: undefined,
    documentCount: 10,
    searchMode: 'hybrid',
    hybridAlpha: undefined,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
    ...overrides
  }
}

function createDocument(text: string, chunkIndex: number): Document {
  return new Document({
    text,
    metadata: {
      source: `source-${chunkIndex}`,
      itemId: KNOWLEDGE_ITEM_ID,
      itemType: 'note',
      chunkIndex,
      tokenCount: text.length
    }
  })
}

describe('knowledge embedding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.aiEmbedManyMock.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => [0.1, 0.2, 0.3])
    }))
  })

  it('embeds a search query through AiService', async () => {
    await expect(embedKnowledgeQuery(createBase(), 'hello')).resolves.toEqual([0.1, 0.2, 0.3])

    expect(mocks.aiEmbedManyMock).toHaveBeenCalledWith({
      uniqueModelId: 'provider::embed',
      values: ['hello'],
      requestOptions: undefined
    })
  })

  it('embeds documents as ordered vector-store nodes', async () => {
    const controller = new AbortController()
    const documents = [createDocument('first', 0), createDocument('second', 1)]

    const nodes = await embedKnowledgeDocuments(createBase(), documents, controller.signal)

    expect(mocks.aiEmbedManyMock).toHaveBeenCalledWith({
      uniqueModelId: 'provider::embed',
      values: ['first', 'second'],
      requestOptions: { signal: controller.signal }
    })
    expect(nodes.map((node) => node.text)).toEqual(['first', 'second'])
    expect(nodes.map((node) => node.embedding)).toEqual([
      [0.1, 0.2, 0.3],
      [0.1, 0.2, 0.3]
    ])
    expect(nodes[0].relationships[NodeRelationship.SOURCE]).toEqual({
      nodeId: KNOWLEDGE_ITEM_ID,
      metadata: documents[0].metadata
    })
  })

  it('does not call AiService for empty documents', async () => {
    await expect(embedKnowledgeDocuments(createBase(), [])).resolves.toEqual([])

    expect(mocks.aiEmbedManyMock).not.toHaveBeenCalled()
  })

  it('throws a knowledge error for an invalid embedding model id', async () => {
    await expect(embedKnowledgeQuery(createBase({ embeddingModelId: 'invalid-model' }), 'hello')).rejects.toThrow(
      `Invalid operation: embed knowledge content - Knowledge base '${KNOWLEDGE_BASE_ID}' has invalid embedding model`
    )

    expect(mocks.aiEmbedManyMock).not.toHaveBeenCalled()
  })

  it('throws a knowledge error when dimensions are missing', async () => {
    await expect(embedKnowledgeQuery(createBase({ dimensions: null }), 'hello')).rejects.toThrow(
      `Invalid operation: embed knowledge content - Knowledge base '${KNOWLEDGE_BASE_ID}' has no embedding dimensions configured`
    )
  })

  it('throws a knowledge error when the vector count differs from the input count', async () => {
    mocks.aiEmbedManyMock.mockResolvedValueOnce({ embeddings: [[0.1, 0.2, 0.3]] })

    await expect(
      embedKnowledgeDocuments(createBase(), [createDocument('first', 0), createDocument('second', 1)])
    ).rejects.toThrow(
      `Invalid operation: embed knowledge content - Embedding model returned 1 vectors for 2 inputs in knowledge base '${KNOWLEDGE_BASE_ID}'`
    )
  })

  it('throws a knowledge error when the model returns an empty vector', async () => {
    mocks.aiEmbedManyMock.mockResolvedValueOnce({ embeddings: [[]] })

    await expect(embedKnowledgeQuery(createBase(), 'hello')).rejects.toThrow(
      `Invalid operation: embed knowledge content - Embedding model returned empty vector at index 0 for knowledge base '${KNOWLEDGE_BASE_ID}'`
    )
  })

  it('throws a knowledge error when vector width differs from base dimensions', async () => {
    mocks.aiEmbedManyMock.mockResolvedValueOnce({ embeddings: [[0.1, 0.2]] })

    await expect(embedKnowledgeQuery(createBase(), 'hello')).rejects.toThrow(
      `Invalid operation: embed knowledge content - Embedding model returned vector width 2, expected 3, at index 0 for knowledge base '${KNOWLEDGE_BASE_ID}'`
    )
  })
})
