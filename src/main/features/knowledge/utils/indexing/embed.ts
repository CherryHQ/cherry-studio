import { application } from '@application'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { isCompletedVectorKnowledgeBase } from '@shared/data/types/knowledge'
import { UniqueModelIdSchema } from '@shared/data/types/model'

/**
 * Query-side instruct prefixes for instruction-aware, asymmetric retrieval embedding models.
 * Such models are trained with a task instruction on the QUERY only; documents stay plain text.
 * The prefix is therefore applied in {@link embedKnowledgeQuery} and never in
 * {@link embedKnowledgeTexts}, so indexed chunks stay plain and existing indexes remain valid
 * (no re-embedding needed).
 *
 * To support another query-prefix model, append an entry — `matches` receives the lowercased
 * `provider::model` id. Models that also need a DOCUMENT-side prefix (e.g. E5's `query:`/`passage:`,
 * nomic's `search_query:`/`search_document:`) do NOT belong here: they require prefixing documents
 * at index time and re-embedding the corpus, which is a separate change.
 */
const QUERY_INSTRUCT_PREFIXES: ReadonlyArray<{ matches: (modelId: string) => boolean; prefix: string }> = [
  {
    // Qwen3-Embedding, per its Hugging Face model card — omitting the instruct costs ~1-5% retrieval quality.
    matches: (modelId) => modelId.includes('qwen3-embedding'),
    prefix: 'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: '
  }
]

/** The query-side instruct prefix for the base's embedding model, or '' when none applies. */
function queryInstructPrefix(embeddingModelId: string | null): string {
  if (embeddingModelId === null) {
    return ''
  }
  const modelId = embeddingModelId.toLowerCase()
  return QUERY_INSTRUCT_PREFIXES.find((entry) => entry.matches(modelId))?.prefix ?? ''
}

export async function embedKnowledgeQuery(base: KnowledgeBase, query: string): Promise<number[]> {
  const [embedding] = await embedKnowledgeTexts(base, [queryInstructPrefix(base.embeddingModelId) + query])
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
  if (!isCompletedVectorKnowledgeBase(base)) {
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
