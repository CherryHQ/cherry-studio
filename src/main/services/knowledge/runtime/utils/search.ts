import type { KnowledgeBase, KnowledgeSearchResult, KnowledgeSearchScoreKind } from '@shared/data/types/knowledge'

const DEFAULT_SEARCH_THRESHOLD = 0

export const getInitialSearchScoreKind = (base: Pick<KnowledgeBase, 'searchMode'>): KnowledgeSearchScoreKind => {
  return (base.searchMode ?? 'default') === 'default' ? 'relevance' : 'ranking'
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
