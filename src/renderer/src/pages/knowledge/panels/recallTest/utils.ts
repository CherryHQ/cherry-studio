import type { KnowledgeSearchResult } from '@shared/data/types/knowledge'

import type { RecallResultItem } from './types'

const MAX_HISTORY_QUERY_COUNT = 5

export const prependHistoryQuery = (queries: string[], query: string) => {
  return [query, ...queries.filter((item) => item !== query)].slice(0, MAX_HISTORY_QUERY_COUNT)
}

export const formatRecallScore = (score: number) => score.toFixed(2)
export const formatRecallPercent = (score: number) => `${Math.round(Math.max(0, Math.min(score, 1)) * 100)}%`

export const mapRecallResult = (result: KnowledgeSearchResult): RecallResultItem => {
  return {
    id: result.chunkId,
    sourceName: result.metadata.source,
    chunkIndex: result.metadata.chunkIndex,
    tokenCount: result.metadata.tokenCount,
    score: result.score,
    scoreKind: result.scoreKind,
    rank: result.rank,
    content: result.pageContent,
    plainText: result.pageContent
  }
}
