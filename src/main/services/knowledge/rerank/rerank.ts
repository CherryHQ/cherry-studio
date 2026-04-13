import { loggerService } from '@logger'
import { DEFAULT_DOCUMENT_COUNT, DEFAULT_RELEVANT_SCORE } from '@main/utils/knowledge'
import type { KnowledgeBase, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { net } from 'electron'

import { parseCompositeModelId } from '../utils/config'
import { getRerankAdapter } from './adapters'
import type { ResolvedRerankRuntime } from './types'

const logger = loggerService.withContext('KnowledgeRerank')

function mergeRerankResults(
  searchResults: KnowledgeSearchResult[],
  rerankResults: Array<{ index: number; relevanceScore: number }>
): KnowledgeSearchResult[] {
  const resultMap = new Map(
    rerankResults.map((result) => [result.index, result.relevanceScore || DEFAULT_RELEVANT_SCORE])
  )

  return searchResults
    .map((result, index) => {
      const score = resultMap.get(index)
      if (score === undefined) {
        return undefined
      }

      return { ...result, score }
    })
    .filter((result): result is KnowledgeSearchResult => result !== undefined)
    .sort((a, b) => b.score - a.score)
}

export async function resolveRerankRuntime(base: KnowledgeBase): Promise<ResolvedRerankRuntime | null> {
  if (!base.rerankModelId) {
    return null
  }

  const { providerId, modelId } = parseCompositeModelId(base.rerankModelId)

  // TODO(v2): Read provider runtime config from the model/provider domain after the
  // pending provider/model PR lands.
  // const { baseUrl, apiKey } = modelProviderService.getRuntimeConfig(providerId)
  void providerId
  void modelId
  return null
}

export async function executeRerankRequest(
  runtime: ResolvedRerankRuntime,
  query: string,
  searchResults: KnowledgeSearchResult[],
  topN: number
): Promise<KnowledgeSearchResult[]> {
  const adapter = getRerankAdapter(runtime.providerId)
  const requestBody = adapter.buildBody({
    modelId: runtime.modelId,
    query,
    documents: searchResults.map((result) => result.pageContent),
    topN
  })
  const url = adapter.buildUrl(runtime.baseUrl)

  try {
    const response = await net.fetch(url, {
      method: 'POST',
      headers: adapter.buildHeaders(runtime.apiKey),
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return mergeRerankResults(searchResults, adapter.parseResponse(await response.json()))
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error('Knowledge rerank request failed', normalizedError, {
      providerId: runtime.providerId,
      modelId: runtime.modelId,
      topN
    })
    throw normalizedError
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

  const runtime = await resolveRerankRuntime(base)
  if (!runtime) {
    logger.debug('Skipping knowledge rerank until provider runtime config is available', {
      baseId: base.id,
      rerankModelId: base.rerankModelId
    })
    return searchResults
  }

  return await executeRerankRequest(runtime, query, searchResults, base.documentCount ?? DEFAULT_DOCUMENT_COUNT)
}
