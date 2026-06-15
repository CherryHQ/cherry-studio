import { application } from '@application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { isCompletedKnowledgeBase } from '@shared/data/types/knowledge'
import { UniqueModelIdSchema } from '@shared/data/types/model'

export async function embedKnowledgeQuery(base: KnowledgeBase, query: string): Promise<number[]> {
  const [embedding] = await embedKnowledgeTexts(base, [query])
  return embedding
}

/** Embed an array of texts in order, validating the model's output dimensions. Empty input → empty output. */
export async function embedKnowledgeTexts(
  base: KnowledgeBase,
  values: string[],
  signal?: AbortSignal
): Promise<number[][]> {
  if (values.length === 0) {
    return []
  }

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
