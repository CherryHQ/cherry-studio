import { application } from '@application'
import { loggerService } from '@logger'
import { DEFAULT_DOCUMENT_COUNT, DEFAULT_RELEVANT_SCORE } from '@main/utils/knowledge'
import type { KnowledgeBase, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { UniqueModelIdSchema } from '@shared/data/types/model'
import { APICallError } from 'ai'

const logger = loggerService.withContext('KnowledgeRerank')

// HTTP statuses that signal a persistent rerank misconfiguration (bad key / no access /
// wrong model) rather than a transient blip — these will keep failing every search.
const PERSISTENT_RERANK_STATUS_CODES = new Set([401, 403, 404])

function isPersistentRerankMisconfig(error: unknown): boolean {
  return APICallError.isInstance(error) && PERSISTENT_RERANK_STATUS_CODES.has(error.statusCode ?? 0)
}

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
    // A malformed model id fails identically on every search, so search is silently
    // degraded indefinitely — log at error level so the misconfiguration is visible.
    logger.error('Skipping knowledge rerank because rerank model id is invalid', {
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
    const context = {
      baseId: base.id,
      rerankModelId: base.rerankModelId,
      topN
    }
    // Persistent misconfiguration (401/403/404) degrades every search forever, so escalate
    // to error; transient failures (network/timeout/429/5xx) stay at warn. Pass the Error
    // instance itself so the stack and cause survive into the log.
    if (isPersistentRerankMisconfig(error)) {
      logger.error('Knowledge rerank failed, returning vector search results', normalizedError, context)
    } else {
      logger.warn('Knowledge rerank failed, returning vector search results', normalizedError, context)
    }
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
