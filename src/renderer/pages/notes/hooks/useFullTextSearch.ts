import { ipcApi } from '@renderer/ipc'
import type { NotesSearchOptions, NotesSearchResult, NotesTreeNode } from '@shared/types/note'
import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'

export interface UseFullTextSearchOptions extends NotesSearchOptions {
  debounceMs?: number
  maxResults?: number
  enabled?: boolean
}

export interface UseFullTextSearchReturn {
  search: (nodes: NotesTreeNode[], keyword: string) => void
  cancel: () => void
  reset: () => void
  isSearching: boolean
  results: NotesSearchResult[]
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
  const [results, setResults] = useState<NotesSearchResult[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [stats, setStats] = useState({
    total: 0,
    fileNameMatches: 0,
    contentMatches: 0,
    bothMatches: 0
  })

  const activeRequestIdRef = useRef<string | null>(null)
  const requestGenerationRef = useRef(0)
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
    requestGenerationRef.current += 1

    const requestId = activeRequestIdRef.current
    activeRequestIdRef.current = null
    if (requestId) {
      void ipcApi.request('notes.full_text.cancel', { requestId }).catch(() => undefined)
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
    setStats({ total: 0, fileNameMatches: 0, contentMatches: 0, bothMatches: 0 })
    setError(null)
  }, [cancel])

  const performSearch = useCallback(async (nodes: NotesTreeNode[], keyword: string) => {
    if (!enabledRef.current) {
      return
    }

    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) {
      setResults([])
      setStats({ total: 0, fileNameMatches: 0, contentMatches: 0, bothMatches: 0 })
      return
    }

    setIsSearching(true)
    setError(null)

    const requestId = uuid()
    const generation = requestGenerationRef.current + 1
    requestGenerationRef.current = generation
    activeRequestIdRef.current = requestId

    try {
      const searchResults = await ipcApi.request('notes.full_text.search', {
        requestId,
        nodes,
        keyword: normalizedKeyword,
        options: searchOptionsRef.current,
        maxResults: maxResultsRef.current
      })

      if (requestGenerationRef.current !== generation) {
        return
      }

      const newStats = {
        total: searchResults.length,
        fileNameMatches: searchResults.filter((r) => r.matchType === 'filename').length,
        contentMatches: searchResults.filter((r) => r.matchType === 'content').length,
        bothMatches: searchResults.filter((r) => r.matchType === 'both').length
      }

      setResults(searchResults)
      setStats(newStats)
    } catch (err) {
      if (requestGenerationRef.current === generation && err instanceof Error && err.name !== 'AbortError') {
        setError(err)
      }
    } finally {
      if (requestGenerationRef.current === generation) {
        if (activeRequestIdRef.current === requestId) {
          activeRequestIdRef.current = null
        }
        setIsSearching(false)
      }
    }
  }, [])

  const search = useCallback(
    (nodes: NotesTreeNode[], keyword: string) => {
      cancel()

      debounceTimerRef.current = setTimeout(() => {
        void performSearch(nodes, keyword)
      }, debounceMs)
    },
    [cancel, performSearch, debounceMs]
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
    stats,
    error
  }
}
