export interface RecallHistoryItem {
  id: string
  query: string
}

export interface RecallResultItem {
  id: string
  sourceName: string
  chunkIndex: number
  score: number
  content: string
  plainText: string
}

export interface RecallTestState {
  query: string
  historyItems: RecallHistoryItem[]
  isHistoryOpen: boolean
  isSearching: boolean
  hasSearched: boolean
  results: RecallResultItem[]
  duration: number
  topScore: number
}

export interface RecallTestActions {
  setQuery: (query: string) => void
  setHistoryOpen: (open: boolean) => void
  runSearch: () => void
  selectHistory: (item: RecallHistoryItem) => void
  removeHistory: (historyId: string) => void
  clearHistory: () => void
}

export interface RecallTestMeta {
  baseId: string
}

export interface RecallTestContextValue {
  state: RecallTestState
  actions: RecallTestActions
  meta: RecallTestMeta
}
