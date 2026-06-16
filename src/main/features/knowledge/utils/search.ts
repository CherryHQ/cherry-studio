import type { KnowledgeBase, KnowledgeSearchResult, KnowledgeSearchScoreKind } from '@shared/data/types/knowledge'

const DEFAULT_SEARCH_THRESHOLD = 0

/**
 * Only 'vector' mode yields a 'relevance' score: it runs cosine search, whose
 * similarity is comparable to a [0,1] threshold. 'bm25' and 'hybrid' yield
 * 'ranking' scores — negated BM25 and RRF — whose scales aren't threshold-
 * comparable, so they're tagged 'ranking' and bypass the threshold below.
 */
export const getInitialSearchScoreKind = (base: Pick<KnowledgeBase, 'searchMode'>): KnowledgeSearchScoreKind => {
  return base.searchMode === 'vector' ? 'relevance' : 'ranking'
}

/**
 * Drop results below `threshold`, but only those scored as 'relevance'. 'ranking'
 * results (BM25 / RRF ordering signals) pass through untouched — their scores
 * aren't on a relevance scale, so a relevance threshold can't gate them. A
 * successful rerank re-tags its output 'relevance', so reranked bm25/hybrid
 * results do get thresholded.
 */
export const applyRelevanceThreshold = (
  results: KnowledgeSearchResult[],
  threshold = DEFAULT_SEARCH_THRESHOLD
): KnowledgeSearchResult[] => {
  return results.filter((result) => result.scoreKind !== 'relevance' || result.score >= threshold)
}

export const withSearchRanks = (results: KnowledgeSearchResult[]): KnowledgeSearchResult[] => {
  return results.map((result, index) => ({ ...result, rank: index + 1 }))
}
