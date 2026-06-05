import { application } from '@application'
import { loggerService } from '@logger'
import { DEFAULT_DOCUMENT_COUNT, DEFAULT_RELEVANT_SCORE } from '@main/utils/knowledge'
import type { KnowledgeBase, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { UniqueModelIdSchema } from '@shared/data/types/model'

const logger = loggerService.withContext('KnowledgeRerank')

function mergeRerankResults(
  searchResults: KnowledgeSearchResult[],
  rerankResults: Array<{ originalIndex: number; score: number }>
): KnowledgeSearchResult[] {
  const resultMap = new Map(
    rerankResults.map((result) => [result.originalIndex, result.score ?? DEFAULT_RELEVANT_SCORE])
  )

  const rerankedResults: KnowledgeSearchResult[] = []

  for (const [index, result] of searchResults.entries()) {
    const score = resultMap.get(index)
    if (score === undefined) {
      continue
    }

    rerankedResults.push({ ...result, score, scoreKind: 'relevance' })
  }

  return rerankedResults.sort((a, b) => b.score - a.score).map((result, index) => ({ ...result, rank: index + 1 }))
}

async function rerankWithAiService(
  base: KnowledgeBase,
  query: string,
  searchResults: KnowledgeSearchResult[],
  topN: number
): Promise<KnowledgeSearchResult[]> {
  const parsed = UniqueModelIdSchema.safeParse(base.rerankModelId)
  if (!parsed.success) {
    logger.warn('Skipping knowledge rerank because rerank model id is invalid', {
      baseId: base.id,
      rerankModelId: base.rerankModelId
    })
    return searchResults
  }

  try {
    const result = await application.get('AiService').rerank({
      uniqueModelId: parsed.data,
      query,
      documents: searchResults.map((result) => result.pageContent),
      topN
    })

    return mergeRerankResults(searchResults, result.ranking)
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.warn('Knowledge rerank failed, returning vector search results', {
      baseId: base.id,
      rerankModelId: base.rerankModelId,
      error: normalizedError.message,
      topN
    })
    return searchResults
  }
}

export async function rerankKnowledgeSearchResults(
  base: KnowledgeBase,
  query: string,
  searchResults: KnowledgeSearchResult[]
): Promise<KnowledgeSearchResult[]> {
  if (!base.rerankModelId || searchResults.length === 0) {
    return searchResults
  }

  return await rerankWithAiService(base, query, searchResults, base.documentCount ?? DEFAULT_DOCUMENT_COUNT)
}
