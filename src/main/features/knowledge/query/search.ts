import type { KnowledgeSearchResult, KnowledgeSearchScoreKind } from '@shared/data/types/knowledge'

import type { KnowledgeIndexSearchMode } from '../pipeline/vectorstore/indexStore/model'

const DEFAULT_SEARCH_THRESHOLD = 0

/**
 * Only 'vector' mode yields a 'relevance' score: it runs cosine search, whose
 * similarity is comparable across vector results. 'bm25' and 'hybrid' yield
 * 'ranking' scores — negated BM25 and RRF — whose scales aren't comparable to
 * vector relevance scores.
 */
export const getInitialSearchScoreKind = (mode: KnowledgeIndexSearchMode): KnowledgeSearchScoreKind => {
  return mode === 'vector' ? 'relevance' : 'ranking'
}

export const applyRelevanceThreshold = (
  results: KnowledgeSearchResult[],
  threshold = DEFAULT_SEARCH_THRESHOLD
): KnowledgeSearchResult[] => {
  return results.filter((result) => result.scoreKind !== 'relevance' || result.score >= threshold)
}

export const withSearchRanks = (results: KnowledgeSearchResult[]): KnowledgeSearchResult[] => {
  return results.map((result, index) => ({ ...result, rank: index + 1 }))
}
