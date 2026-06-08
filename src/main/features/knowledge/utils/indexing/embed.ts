import { application } from '@application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { isCompletedKnowledgeBase } from '@shared/data/types/knowledge'
import { UniqueModelIdSchema } from '@shared/data/types/model'
import { type Document as VectorStoreDocument, NodeRelationship, TextNode } from '@vectorstores/core'

export async function embedKnowledgeQuery(base: KnowledgeBase, query: string): Promise<number[]> {
  const embeddings = await embedKnowledgeValues(base, [query])
  return embeddings[0]
}

export async function embedKnowledgeDocuments(
  base: KnowledgeBase,
  documents: VectorStoreDocument[],
  signal?: AbortSignal
): Promise<TextNode[]> {
  if (documents.length === 0) {
    return []
  }

  const values = documents.map((document) => document.text)
  const embeddings = await embedKnowledgeValues(base, values, signal)

  return documents.map(
    (document, index) =>
      new TextNode({
        text: document.text,
        embedding: embeddings[index],
        metadata: document.metadata,
        relationships: {
          [NodeRelationship.SOURCE]: {
            nodeId: String(document.metadata.itemId),
            metadata: document.metadata
          }
        }
      })
  )
}

async function embedKnowledgeValues(base: KnowledgeBase, values: string[], signal?: AbortSignal): Promise<number[][]> {
  const uniqueModelId = parseEmbeddingModelId(base)
  const result = await application.get('AiService').embedMany({
    uniqueModelId,
    values,
    requestOptions: signal ? { signal } : undefined
  })

  return assertEmbeddingVectors(base, values.length, result.embeddings)
}

function parseEmbeddingModelId(base: KnowledgeBase) {
  const parsed = UniqueModelIdSchema.safeParse(base.embeddingModelId)
  if (parsed.success) {
    return parsed.data
  }

  throw DataApiErrorFactory.invalidOperation(
    'embed knowledge content',
    `Knowledge base '${base.id}' has invalid embedding model`
  )
}

function assertEmbeddingVectors(base: KnowledgeBase, expectedCount: number, embeddings: number[][]): number[][] {
  if (!isCompletedKnowledgeBase(base)) {
    throw DataApiErrorFactory.invalidOperation(
      'embed knowledge content',
      `Knowledge base '${base.id}' has no embedding dimensions configured`
    )
  }

  if (embeddings.length !== expectedCount) {
    throw DataApiErrorFactory.invalidOperation(
      'embed knowledge content',
      `Embedding model returned ${embeddings.length} vectors for ${expectedCount} inputs in knowledge base '${base.id}'`
    )
  }

  for (const [index, embedding] of embeddings.entries()) {
    if (embedding.length === 0) {
      throw DataApiErrorFactory.invalidOperation(
        'embed knowledge content',
        `Embedding model returned empty vector at index ${index} for knowledge base '${base.id}'`
      )
    }

    if (embedding.length !== base.dimensions) {
      throw DataApiErrorFactory.invalidOperation(
        'embed knowledge content',
        `Embedding model returned vector width ${embedding.length}, expected ${base.dimensions}, at index ${index} for knowledge base '${base.id}'`
      )
    }
  }

  return embeddings
}
