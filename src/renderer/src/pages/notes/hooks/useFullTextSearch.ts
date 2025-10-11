import { searchAllFiles, SearchOptions, SearchResult } from '@renderer/services/NotesSearchService'
import { NotesTreeNode } from '@renderer/types/note'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseFullTextSearchOptions extends SearchOptions {
  debounceMs?: number
  maxResults?: number
  enabled?: boolean
}

export interface UseFullTextSearchReturn {
  search: (nodes: NotesTreeNode[], keyword: string) => void
  cancel: () => void
  isSearching: boolean
  results: SearchResult[]
  stats: {
    total: number
    fileNameMatches: number
    contentMatches: number
    bothMatches: number
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
  const [error, setError] = useState<Error | null>(null)
  const [stats, setStats] = useState({
    total: 0,
    fileNameMatches: 0,
    contentMatches: 0,
    bothMatches: 0
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

  const performSearch = useCallback(
    async (nodes: NotesTreeNode[], keyword: string) => {
      if (!enabledRef.current) {
        return
      }

      cancel()

      if (!keyword) {
        setResults([])
        setStats({ total: 0, fileNameMatches: 0, contentMatches: 0, bothMatches: 0 })
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

        const newStats = {
          total: limitedResults.length,
          fileNameMatches: limitedResults.filter((r) => r.matchType === 'filename').length,
          contentMatches: limitedResults.filter((r) => r.matchType === 'content').length,
          bothMatches: limitedResults.filter((r) => r.matchType === 'both').length
        }

        setResults(limitedResults)
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
        performSearch(nodes, keyword)
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
    isSearching,
    results,
    stats,
    error
  }
}
