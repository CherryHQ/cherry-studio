import type { KnowledgeSearchScoreKind } from '@shared/data/types/knowledge'

export interface RecallHistoryItem {
  id: string
  query: string
}

export interface RecallResultItem {
  id: string
  sourceName: string
  chunkIndex: number
  tokenCount: number
  score: number
  scoreKind: KnowledgeSearchScoreKind
  rank: number
  content: string
  plainText: string
}

export interface RecallQueryState {
  query: string
  historyItems: RecallHistoryItem[]
  isHistoryOpen: boolean
}

export interface RecallResultState {
  isSearching: boolean
  hasSearched: boolean
  results: RecallResultItem[]
  duration: number
  topScore: number
  scoreKind: KnowledgeSearchScoreKind | null
}

export interface RecallQueryActions {
  setQuery: (query: string) => void
  setHistoryOpen: (open: boolean) => void
  runSearch: () => void
  selectHistory: (item: RecallHistoryItem) => void
  removeHistory: (historyId: string) => void
  clearHistory: () => void
}

export interface RecallQueryMeta {
  baseId: string
}

export interface RecallQueryContextValue {
  state: RecallQueryState
  actions: RecallQueryActions
  meta: RecallQueryMeta
}

export interface RecallResultContextValue {
  state: RecallResultState
}
