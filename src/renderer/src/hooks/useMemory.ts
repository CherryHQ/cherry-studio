/**
 * useMemory — convenience hooks for memory CRUD operations in the renderer.
 *
 * These are thin wrappers around memoryService that follow React conventions.
 * For settings pages, use these directly. For AI-core flows, go through
 * MemorySearchTool / searchOrchestrationPlugin instead.
 */

import type {
  AddMemoryOptions,
  MemoryDeleteAllOptions,
  MemoryItem,
  MemoryListOptions,
  MemorySearchOptions,
  MemorySearchResult
} from '@shared/memory'
import { useCallback, useEffect, useState } from 'react'

import { memoryService } from '../services/MemoryService'

// ---------------------------------------------------------------------------
// useMemorySearch — searches memories given a query
// ---------------------------------------------------------------------------

export function useMemorySearch(
  query: string,
  options?: MemorySearchOptions
): { data: MemorySearchResult | null; loading: boolean; error: Error | null; refetch: () => void } {
  const [data, setData] = useState<MemorySearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(() => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    memoryService
      .search(query, options)
      .then((result) => {
        setData(result)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      })
  }, [query, options])

  useEffect(() => {
    run()
  }, [run])

  return { data, loading, error, refetch: run }
}

// ---------------------------------------------------------------------------
// useMemoryList — lists all memories for the current scope
// ---------------------------------------------------------------------------

export function useMemoryList(options?: MemoryListOptions): {
  items: MemoryItem[]
  loading: boolean
  error: Error | null
  refetch: () => void
} {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(() => {
    setLoading(true)
    setError(null)
    memoryService
      .list(options)
      .then((result) => {
        setItems(result)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      })
  }, [options])

  useEffect(() => {
    run()
  }, [run])

  return { items, loading, error, refetch: run }
}

// ---------------------------------------------------------------------------
// useMemoryAdd — imperatively add a memory
// ---------------------------------------------------------------------------

export function useMemoryAdd(): {
  add: (content: string | string[], options?: AddMemoryOptions) => Promise<MemoryItem[]>
  loading: boolean
  error: Error | null
} {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const add = useCallback(async (content: string | string[], options?: AddMemoryOptions) => {
    setLoading(true)
    setError(null)
    try {
      const result = await memoryService.add(content, options)
      setLoading(false)
      return result
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      setLoading(false)
      throw e
    }
  }, [])

  return { add, loading, error }
}

// ---------------------------------------------------------------------------
// useMemoryDelete — imperatively delete a memory
// ---------------------------------------------------------------------------

export function useMemoryDelete(): {
  deleteMemory: (id: string) => Promise<void>
  deleteAll: (options?: MemoryDeleteAllOptions) => Promise<void>
  loading: boolean
  error: Error | null
} {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const deleteMemory = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      await memoryService.delete(id)
      setLoading(false)
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      setLoading(false)
      throw e
    }
  }, [])

  const deleteAll = useCallback(async (options?: MemoryDeleteAllOptions) => {
    setLoading(true)
    setError(null)
    try {
      await memoryService.deleteAll(options)
      setLoading(false)
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      setLoading(false)
      throw e
    }
  }, [])

  return { deleteMemory, deleteAll, loading, error }
}
