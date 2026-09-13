import { APICallError } from 'ai'

import { application } from '@application'
import { loggerService } from '@logger'
import { DEFAULT_DOCUMENT_COUNT, DEFAULT_RELEVANT_SCORE } from '@main/utils/knowledge'
import type { KnowledgeBase, KnowledgeSearchResult, KnowledgeSearchWarning } from '@shared/data/types/knowledge'
import { parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'

const logger = loggerService.withContext('KnowledgeRerank')

// HTTP statuses that signal a persistent rerank misconfiguration (bad key / no access /
// wrong model) rather than a transient blip — these will keep failing every search.
const PERSISTENT_RERANK_STATUS_CODES = new Set([401, 403, 404])
const ZHIPU_PROVIDER_ID = 'zhipu'
const ZHIPU_RERANK_MAX_DOCUMENTS = 128
const ZHIPU_RERANK_MAX_TEXT_LENGTH = 4096

function isPersistentRerankMisconfig(error: unknown): boolean {
  return APICallError.isInstance(error) && PERSISTENT_RERANK_STATUS_CODES.has(error.statusCode ?? 0)
}

function mergeRerankResults(
  searchResults: KnowledgeSearchResult[],
  rerankResults: Array<{ originalIndex: number; score: number }>,
  topN: number
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

  return rerankedResults
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .slice(0, topN)
    .map((result, index) => ({ ...result, rank: index + 1 }))
}

function withRerankWarning(
  searchResults: KnowledgeSearchResult[],
  reason: KnowledgeSearchWarning['reason']
): KnowledgeSearchResult[] {
  const warning: KnowledgeSearchWarning = { kind: 'rerank_failed', reason }
  return searchResults.map((result) => ({ ...result, warning }))
}

function readZhipuErrorCode(value: unknown): string | undefined {
  let payload = value
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return undefined
    }
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined

  const record = payload as Record<string, unknown>
  if (typeof record.code === 'string' || typeof record.code === 'number') return String(record.code)
  return readZhipuErrorCode(record.error)
}

function isZhipuInputTooLargeError(error: unknown): boolean {
  return (
    APICallError.isInstance(error) &&
    error.statusCode === 400 &&
    (readZhipuErrorCode(error.responseBody) === '1214' || readZhipuErrorCode(error.data) === '1214')
  )
}

function splitNearHalfByCharacters(
  searchResults: KnowledgeSearchResult[]
): [KnowledgeSearchResult[], KnowledgeSearchResult[]] {
  const totalCharacters = searchResults.reduce((sum, result) => sum + result.pageContent.length, 0)
  let leftCharacters = 0
  let splitIndex = 1
  let smallestDifference = Number.POSITIVE_INFINITY

  for (let index = 1; index < searchResults.length; index += 1) {
    leftCharacters += searchResults[index - 1].pageContent.length
    const difference = Math.abs(totalCharacters - leftCharacters * 2)
    if (difference < smallestDifference) {
      smallestDifference = difference
      splitIndex = index
    }
  }

  return [searchResults.slice(0, splitIndex), searchResults.slice(splitIndex)]
}

async function rerankZhipuBatch(
  uniqueModelId: UniqueModelId,
  query: string,
  searchResults: KnowledgeSearchResult[],
  topN: number,
  indexOffset = 0
): Promise<Array<{ originalIndex: number; score: number }>> {
  if (searchResults.length > ZHIPU_RERANK_MAX_DOCUMENTS) {
    const [left, right] = splitNearHalfByCharacters(searchResults)
    const leftRanking = await rerankZhipuBatch(uniqueModelId, query, left, topN, indexOffset)
    const rightRanking = await rerankZhipuBatch(uniqueModelId, query, right, topN, indexOffset + left.length)
    return [...leftRanking, ...rightRanking]
  }

  try {
    const result = await application.get('AiService').rerank({
      uniqueModelId,
      query,
      documents: searchResults.map((result) => result.pageContent),
      topN: Math.min(topN, searchResults.length)
    })
    return result.ranking.map((result) => ({ ...result, originalIndex: result.originalIndex + indexOffset }))
  } catch (error) {
    if (!isZhipuInputTooLargeError(error) || searchResults.length === 1) throw error

    const [left, right] = splitNearHalfByCharacters(searchResults)
    const leftRanking = await rerankZhipuBatch(uniqueModelId, query, left, topN, indexOffset)
    const rightRanking = await rerankZhipuBatch(uniqueModelId, query, right, topN, indexOffset + left.length)
    return [...leftRanking, ...rightRanking]
  }
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
    return withRerankWarning(searchResults, 'provider_error')
  }

  const { providerId } = parseUniqueModelId(parsed.data)

  if (
    providerId === ZHIPU_PROVIDER_ID &&
    (query.length > ZHIPU_RERANK_MAX_TEXT_LENGTH ||
      searchResults.some((result) => result.pageContent.length > ZHIPU_RERANK_MAX_TEXT_LENGTH))
  ) {
    logger.warn('Skipping Zhipu knowledge rerank because an input exceeds the provider limit', {
      baseId: base.id,
      rerankModelId: base.rerankModelId,
      topN
    })
    return withRerankWarning(searchResults, 'input_too_large')
  }

  try {
    const ranking =
      providerId === ZHIPU_PROVIDER_ID
        ? await rerankZhipuBatch(parsed.data, query, searchResults, topN)
        : (
            await application.get('AiService').rerank({
              uniqueModelId: parsed.data,
              query,
              documents: searchResults.map((result) => result.pageContent),
              topN
            })
          ).ranking

    return mergeRerankResults(searchResults, ranking, topN)
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
    return withRerankWarning(
      searchResults,
      providerId === ZHIPU_PROVIDER_ID && isZhipuInputTooLargeError(error) ? 'input_too_large' : 'provider_error'
    )
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
