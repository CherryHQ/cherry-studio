import type { SearchOptions, SearchResult } from '@renderer/services/NotesSearchService'
import { searchAllFiles } from '@renderer/services/NotesSearchService'
import type { NotesTreeNode } from '@renderer/types/note'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseFullTextSearchOptions extends SearchOptions {
  debounceMs?: number
  maxResults?: number
  enabled?: boolean
}

export interface UseFullTextSearchReturn {
  search: (nodes: NotesTreeNode[], keyword: string) => void
  cancel: () => void
  reset: () => void
  isSearching: boolean
  results: SearchResult[]
  /**
   * The keyword `results` were produced from. Lags the live input across the debounce
   * and the async scan, so consumers must highlight and locate with THIS, not with
   * whatever is currently typed — the two disagree for as long as a search is pending.
   */
  resultsKeyword: string
  /**
   * All three count keyword occurrences, not matched notes: `total` is
   * `nameMatches + contentMatches`, and a note matching in both places contributes to
   * both lanes. Reporting one note per hit would disagree with the result list, which
   * now shows every occurrence.
   */
  stats: {
    total: number
    nameMatches: number
    contentMatches: number
  }
  error: Error | null
}

/**
 * Full-text search hook for notes
 */
export function useFullTextSearch(options: UseFullTextSearchOptions = {}): UseFullTextSearchReturn {
  const { debounceMs = 300, maxResults = 100, enabled = true, ...searchOptions } = options

  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [resultsKeyword, setResultsKeyword] = useState('')
  const [error, setError] = useState<Error | null>(null)
  const [stats, setStats] = useState({
    total: 0,
    nameMatches: 0,
    contentMatches: 0
  })

  const abortControllerRef = useRef<AbortController | null>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Store options in refs to avoid reference changes
  const searchOptionsRef = useRef(searchOptions)
  const maxResultsRef = useRef(maxResults)
  const enabledRef = useRef(enabled)

  useEffect(() => {
    searchOptionsRef.current = searchOptions
    maxResultsRef.current = maxResults
    enabledRef.current = enabled
  }, [searchOptions, maxResults, enabled])

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    setIsSearching(false)
  }, [])

  const reset = useCallback(() => {
    cancel()
    setResults([])
    setResultsKeyword('')
    setStats({ total: 0, nameMatches: 0, contentMatches: 0 })
    setError(null)
  }, [cancel])

  const performSearch = useCallback(
    async (nodes: NotesTreeNode[], keyword: string) => {
      if (!enabledRef.current) {
        return
      }

      cancel()

      if (!keyword) {
        setResults([])
        setResultsKeyword('')
        setStats({ total: 0, nameMatches: 0, contentMatches: 0 })
        return
      }

      setIsSearching(true)
      setError(null)

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      try {
        const searchResults = await searchAllFiles(
          nodes,
          keyword.trim(),
          searchOptionsRef.current,
          abortController.signal
        )

        if (abortController.signal.aborted) {
          return
        }

        const limitedResults = searchResults.slice(0, maxResultsRef.current)

        const nameMatches = limitedResults.reduce((sum, r) => sum + r.nameMatchCount, 0)
        const contentMatches = limitedResults.reduce((sum, r) => sum + (r.matches?.length ?? 0), 0)
        const newStats = {
          total: nameMatches + contentMatches,
          nameMatches,
          contentMatches
        }

        setResults(limitedResults)
        setResultsKeyword(keyword.trim())
        setStats(newStats)
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err)
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsSearching(false)
        }
      }
    },
    [cancel]
  )

  const search = useCallback(
    (nodes: NotesTreeNode[], keyword: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        void performSearch(nodes, keyword)
      }, debounceMs)
    },
    [performSearch, debounceMs]
  )

  useEffect(() => {
    return () => {
      cancel()
    }
  }, [cancel])

  return {
    search,
    cancel,
    reset,
    isSearching,
    results,
    resultsKeyword,
    stats,
    error
  }
}
