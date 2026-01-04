import type { BodyForPath, QueryParamsForPath, ResponseForPath } from '@shared/data/api/apiPaths'
import type { ConcreteApiPaths, PaginationMode } from '@shared/data/api/apiTypes'
import {
  isCursorPaginatedResponse,
  type OffsetPaginatedResponse,
  type PaginatedResponse
} from '@shared/data/api/apiTypes'
import { useCallback, useMemo, useState } from 'react'
import type { KeyedMutator } from 'swr'
import useSWR, { useSWRConfig } from 'swr'
import useSWRInfinite from 'swr/infinite'
import useSWRMutation from 'swr/mutation'

import { dataApiService } from '../DataApiService'

// buildPath function removed - users now pass concrete paths directly

/**
 * Unified fetcher utility for API requests
 * Provides type-safe method dispatching to reduce code duplication
 */
function createApiFetcher<TPath extends ConcreteApiPaths, TMethod extends 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>(
  method: TMethod
) {
  return async (
    path: TPath,
    options?: {
      body?: BodyForPath<TPath, TMethod>
      query?: Record<string, any>
    }
  ): Promise<ResponseForPath<TPath, TMethod>> => {
    switch (method) {
      case 'GET':
        return dataApiService.get(path, { query: options?.query })
      case 'POST':
        return dataApiService.post(path, { body: options?.body, query: options?.query })
      case 'PUT':
        return dataApiService.put(path, { body: options?.body || {}, query: options?.query })
      case 'DELETE':
        return dataApiService.delete(path, { query: options?.query })
      case 'PATCH':
        return dataApiService.patch(path, { body: options?.body, query: options?.query })
      default:
        throw new Error(`Unsupported method: ${method}`)
    }
  }
}

/**
 * Build SWR cache key for request identification and caching
 * Creates a unique key based on path and query parameters
 *
 * @param path - The concrete API path
 * @param query - Query parameters
 * @returns SWR key tuple or null if disabled
 *
 * @example
 * ```typescript
 * buildSWRKey('/topics', { page: 1 }) // Returns ['/topics', { page: 1 }]
 * buildSWRKey('/topics/123') // Returns ['/topics/123']
 * ```
 */
function buildSWRKey<TPath extends ConcreteApiPaths>(
  path: TPath,
  query?: Record<string, any>
): [TPath, Record<string, any>?] | null {
  if (query && Object.keys(query).length > 0) {
    return [path, query]
  }

  return [path]
}

/**
 * GET request fetcher for SWR
 * @param args - Tuple containing [path, query] parameters
 * @returns Promise resolving to the fetched data
 */
function getFetcher<TPath extends ConcreteApiPaths>([path, query]: [TPath, Record<string, any>?]): Promise<
  ResponseForPath<TPath, 'GET'>
> {
  const apiFetcher = createApiFetcher('GET')
  return apiFetcher(path, { query })
}

/**
 * React hook for data fetching with SWR
 * Provides type-safe API calls with caching, revalidation, and error handling
 *
 * @template TPath - The concrete API path type
 * @param path - The concrete API endpoint path (e.g., '/test/items/123')
 * @param options - Configuration options
 * @param options.query - Query parameters for filtering, pagination, etc.
 * @param options.enabled - Whether the request should be executed (default: true)
 * @param options.swrOptions - Additional SWR configuration options
 * @returns Object containing data, loading state, error state, and control functions
 *
 * @example
 * ```typescript
 * // Basic usage with type-safe concrete path
 * const { data, loading, error } = useQuery('/test/items')
 * // data is automatically typed as PaginatedResponse<any>
 *
 * // With dynamic ID - full type safety
 * const { data, loading, error } = useQuery(`/test/items/${itemId}`, {
 *   enabled: !!itemId
 * })
 * // data is automatically typed as the specific item type
 *
 * // With type-safe query parameters
 * const { data, loading, error } = useQuery('/test/items', {
 *   query: {
 *     page: 1,
 *     limit: 20,
 *     search: 'hello',  // TypeScript validates these fields
 *     status: 'active'
 *   }
 * })
 *
 * // With custom SWR options
 * const { data, loading, error, refetch } = useQuery('/test/items', {
 *   swrOptions: {
 *     refreshInterval: 5000,  // Auto-refresh every 5 seconds
 *     revalidateOnFocus: true
 *   }
 * })
 *
 * // Optimistic updates with mutate (bound to current key, no key needed)
 * const { data, mutate } = useQuery(`/topics/${id}`)
 *
 * // Update cache immediately without revalidation
 * await mutate({ ...data, title: 'New Title' }, false)
 *
 * // Update cache with function and revalidate
 * await mutate(prev => ({ ...prev, count: prev.count + 1 }))
 *
 * // Just revalidate (refetch from server)
 * await mutate()
 * ```
 */
export function useQuery<TPath extends ConcreteApiPaths>(
  path: TPath,
  options?: {
    /** Query parameters for filtering, pagination, etc. */
    query?: QueryParamsForPath<TPath>
    /** Disable the request */
    enabled?: boolean
    /** Custom SWR options */
    swrOptions?: Parameters<typeof useSWR>[2]
  }
): {
  /** The fetched data */
  data?: ResponseForPath<TPath, 'GET'>
  /** True during initial load (no data yet) */
  isLoading: boolean
  /** True during any request (including background refresh) */
  isRefreshing: boolean
  /** Error if request failed */
  error?: Error
  /** Function to manually refetch data */
  refetch: () => void
  /** SWR mutate function for optimistic updates */
  mutate: KeyedMutator<ResponseForPath<TPath, 'GET'>>
} {
  // Internal type conversion for SWR compatibility
  const key = options?.enabled !== false ? buildSWRKey(path, options?.query as Record<string, any>) : null

  const { data, error, isLoading, isValidating, mutate } = useSWR(key, getFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 5000,
    errorRetryCount: 3,
    errorRetryInterval: 1000,
    ...options?.swrOptions
  })

  const refetch = () => {
    mutate()
  }

  return {
    data,
    isLoading,
    isRefreshing: isValidating,
    error: error as Error | undefined,
    refetch,
    mutate
  }
}

/**
 * React hook for mutation operations (POST, PUT, DELETE, PATCH)
 * Provides optimized handling of side-effect operations with automatic cache invalidation
 *
 * @template TPath - The concrete API path type
 * @param method - HTTP method for the mutation
 * @param path - The concrete API endpoint path (e.g., '/test/items/123')
 * @param options - Configuration options
 * @param options.onSuccess - Callback executed on successful mutation
 * @param options.onError - Callback executed on mutation error
 * @param options.revalidate - Cache invalidation strategy (true = invalidate all, string[] = specific paths)
 * @returns Object containing mutate function, loading state, and error state
 *
 * @example
 * ```typescript
 * // Create a new item with full type safety
 * const createItem = useMutation('POST', '/test/items', {
 *   onSuccess: (data) => {
 *     console.log('Item created:', data) // data is properly typed
 *   },
 *   onError: (error) => {
 *     console.error('Failed to create item:', error)
 *   },
 *   revalidate: ['/test/items']  // Refresh items list after creation
 * })
 *
 * // Update existing item with optimistic updates
 * const updateItem = useMutation('PUT', `/test/items/${itemId}`, {
 *   optimistic: true,
 *   optimisticData: { id: itemId, title: 'Updated Item' }, // Type-safe
 *   revalidate: true  // Refresh all cached data
 * })
 *
 * // Delete item
 * const deleteItem = useMutation('DELETE', `/test/items/${itemId}`)
 *
 * // Usage in component with type-safe parameters
 * const handleCreate = async () => {
 *   try {
 *     const result = await createItem.mutate({
 *       body: {
 *         title: 'New Item',
 *         description: 'Item description',
 *         // TypeScript validates all fields against ApiSchemas
 *         tags: ['tag1', 'tag2']
 *       }
 *     })
 *     console.log('Created:', result)
 *   } catch (error) {
 *     console.error('Creation failed:', error)
 *   }
 * }
 *
 * const handleUpdate = async () => {
 *   try {
 *     const result = await updateItem.mutate({
 *       body: { title: 'Updated Item' } // Type-safe, only valid fields allowed
 *     })
 *   } catch (error) {
 *     console.error('Update failed:', error)
 *   }
 * }
 *
 * const handleDelete = async () => {
 *   try {
 *     await deleteItem.mutate()
 *   } catch (error) {
 *     console.error('Delete failed:', error)
 *   }
 * }
 * ```
 */

export function useMutation<TPath extends ConcreteApiPaths, TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'>(
  method: TMethod,
  path: TPath,
  options?: {
    /** Called when mutation succeeds */
    onSuccess?: (data: ResponseForPath<TPath, TMethod>) => void
    /** Called when mutation fails */
    onError?: (error: Error) => void
    /** Automatically revalidate these SWR keys on success */
    revalidate?: boolean | string[]
    /** Enable optimistic updates */
    optimistic?: boolean
    /** Optimistic data to use for updates */
    optimisticData?: ResponseForPath<TPath, TMethod>
  }
): {
  /** Function to execute the mutation */
  mutate: (data?: {
    body?: BodyForPath<TPath, TMethod>
    query?: QueryParamsForPath<TPath>
  }) => Promise<ResponseForPath<TPath, TMethod>>
  /** True while the mutation is in progress */
  isLoading: boolean
  /** Error object if the mutation failed */
  error: Error | undefined
} {
  const { mutate: globalMutate } = useSWRConfig()

  const apiFetcher = createApiFetcher(method)

  const fetcher = async (
    _key: string,
    {
      arg
    }: {
      arg?: {
        body?: BodyForPath<TPath, TMethod>
        query?: Record<string, any>
      }
    }
  ): Promise<ResponseForPath<TPath, TMethod>> => {
    return apiFetcher(path, { body: arg?.body, query: arg?.query })
  }

  const { trigger, isMutating, error } = useSWRMutation(path as string, fetcher, {
    populateCache: false,
    revalidate: false,
    onSuccess: async (data) => {
      options?.onSuccess?.(data)

      if (options?.revalidate === true) {
        await globalMutate(() => true)
      } else if (Array.isArray(options?.revalidate)) {
        for (const path of options.revalidate) {
          await globalMutate(path)
        }
      }
    },
    onError: options?.onError
  })

  const optimisticMutate = async (data?: {
    body?: BodyForPath<TPath, TMethod>
    query?: QueryParamsForPath<TPath>
  }): Promise<ResponseForPath<TPath, TMethod>> => {
    if (options?.optimistic && options?.optimisticData) {
      // Apply optimistic update
      await globalMutate(path, options.optimisticData, false)
    }

    try {
      // Convert user's strongly-typed query to Record<string, any> for internal use
      const convertedData = data
        ? {
            body: data.body,
            query: data.query as Record<string, any>
          }
        : undefined

      const result = await trigger(convertedData)

      // Revalidate with real data after successful mutation
      if (options?.optimistic) {
        await globalMutate(path)
      }

      return result
    } catch (err) {
      // Revert optimistic update on error
      if (options?.optimistic && options?.optimisticData) {
        await globalMutate(path)
      }
      throw err
    }
  }

  // Wrapper for non-optimistic mutations to handle type conversion
  const normalMutate = async (data?: {
    body?: BodyForPath<TPath, TMethod>
    query?: QueryParamsForPath<TPath>
  }): Promise<ResponseForPath<TPath, TMethod>> => {
    // Convert user's strongly-typed query to Record<string, any> for internal use
    const convertedData = data
      ? {
          body: data.body,
          query: data.query as Record<string, any>
        }
      : undefined

    return trigger(convertedData)
  }

  return {
    mutate: options?.optimistic ? optimisticMutate : normalMutate,
    isLoading: isMutating,
    error
  }
}

/**
 * Hook for invalidating SWR cache entries
 * Must be used inside a React component or hook
 *
 * @returns Function to invalidate cache entries
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const invalidate = useInvalidateCache()
 *
 *   const handleInvalidate = async () => {
 *     // Invalidate specific cache key
 *     await invalidate('/test/items')
 *
 *     // Invalidate multiple keys
 *     await invalidate(['/test/items', '/test/stats'])
 *
 *     // Invalidate all cache entries
 *     await invalidate(true)
 *   }
 *
 *   return <button onClick={handleInvalidate}>Refresh Data</button>
 * }
 * ```
 */
export function useInvalidateCache() {
  const { mutate } = useSWRConfig()

  const invalidate = (keys?: string | string[] | boolean): Promise<any> => {
    if (keys === true || keys === undefined) {
      return mutate(() => true)
    } else if (typeof keys === 'string') {
      return mutate(keys)
    } else if (Array.isArray(keys)) {
      return Promise.all(keys.map((key) => mutate(key)))
    }
    return Promise.resolve()
  }

  return invalidate
}

/**
 * Prefetch data for a given path without caching
 * Useful for warming up data before user interactions or pre-loading critical resources
 *
 * @template TPath - The concrete API path type
 * @param path - The concrete API endpoint path (e.g., '/test/items/123')
 * @param options - Configuration options for the prefetch request
 * @param options.query - Query parameters for filtering, pagination, etc.
 * @returns Promise resolving to the prefetched data
 *
 * @example
 * ```typescript
 * // Prefetch items list on component mount
 * useEffect(() => {
 *   prefetch('/test/items', {
 *     query: { page: 1, limit: 20 }
 *   })
 * }, [])
 *
 * // Prefetch specific item on hover
 * const handleItemHover = (itemId: string) => {
 *   prefetch(`/test/items/${itemId}`)
 * }
 *
 * // Prefetch with search parameters
 * const preloadSearchResults = async (searchTerm: string) => {
 *   const results = await prefetch('/test/search', {
 *     query: {
 *       query: searchTerm,
 *       limit: 10
 *     }
 *   })
 *   console.log('Preloaded:', results)
 * }
 * ```
 */
export function prefetch<TPath extends ConcreteApiPaths>(
  path: TPath,
  options?: {
    query?: QueryParamsForPath<TPath>
  }
): Promise<ResponseForPath<TPath, 'GET'>> {
  const apiFetcher = createApiFetcher('GET')
  return apiFetcher(path, { query: options?.query as Record<string, any> })
}

// ============================================================================
// Infinite Query Hook
// ============================================================================

/**
 * Options for useInfiniteQuery hook
 * SWR-related options are consolidated in swrOptions
 */
export interface UseInfiniteQueryOptions<TPath extends ConcreteApiPaths> {
  /** Additional query parameters (excluding pagination params) */
  query?: Omit<QueryParamsForPath<TPath>, 'page' | 'limit' | 'cursor'>
  /** Items per page (default: 10) */
  limit?: number
  /** Pagination mode (default: 'cursor') */
  mode?: PaginationMode
  /** Whether to enable the query (default: true) */
  enabled?: boolean
  /** SWR options (including initialSize, revalidateAll, etc.) */
  swrOptions?: Parameters<typeof useSWRInfinite>[2]
}

/**
 * React hook for infinite scrolling data fetching
 * Uses useSWRInfinite internally for efficient page management
 *
 * @template TPath - The concrete API path type
 * @param path - API endpoint path that returns paginated data
 * @param options - Configuration options for infinite query
 * @returns Object containing accumulated items, loading states, and controls
 *
 * @example
 * ```typescript
 * // Basic usage with cursor mode (default)
 * const { items, hasNext, loadMore, isLoadingMore } = useInfiniteQuery('/test/items', {
 *   limit: 20,
 *   query: { search: 'hello' }
 * })
 *
 * // Offset mode
 * const { items, hasNext, loadMore } = useInfiniteQuery('/test/items', {
 *   mode: 'offset',
 *   limit: 20
 * })
 *
 * // Custom SWR options
 * const { items, hasNext, loadMore } = useInfiniteQuery('/test/items', {
 *   limit: 20,
 *   swrOptions: {
 *     initialSize: 2,           // Load 2 pages initially
 *     revalidateFirstPage: false // Don't auto-refresh first page
 *   }
 * })
 *
 * // With InfiniteScroll component
 * <InfiniteScroll
 *   dataLength={items.length}
 *   next={loadMore}
 *   hasMore={hasNext}
 *   loader={<Spinner />}
 * >
 *   {items.map(item => <ItemCard key={item.id} item={item} />)}
 * </InfiniteScroll>
 * ```
 */
export function useInfiniteQuery<TPath extends ConcreteApiPaths>(
  path: TPath,
  options?: UseInfiniteQueryOptions<TPath>
): ResponseForPath<TPath, 'GET'> extends PaginatedResponse<infer T>
  ? {
      /** Accumulated items from all loaded pages */
      items: T[]
      /** Raw page data array */
      pages: PaginatedResponse<T>[]
      /** Total number of items */
      total: number
      /** Number of pages loaded */
      size: number
      /** True during initial load (no data yet) */
      isLoading: boolean
      /** True during any request (including background refresh) */
      isRefreshing: boolean
      /** Error if request failed */
      error?: Error
      /** Whether there are more pages to load */
      hasNext: boolean
      /** Load the next page */
      loadNext: () => void
      /** Set number of pages to load */
      setSize: (size: number | ((size: number) => number)) => void
      /** Refresh all loaded pages */
      refresh: () => void
      /** Reset to first page only */
      reset: () => void
      /** SWR mutate function */
      mutate: KeyedMutator<PaginatedResponse<T>[]>
    }
  : never {
  const limit = options?.limit ?? 10
  const mode = options?.mode ?? 'cursor' // Default: cursor mode
  const enabled = options?.enabled !== false

  // getKey: Generate SWR key for each page
  const getKey = useCallback(
    (pageIndex: number, previousPageData: PaginatedResponse<any> | null) => {
      if (!enabled) return null

      // Check if we've reached the end
      if (previousPageData) {
        if (mode === 'cursor') {
          if (!isCursorPaginatedResponse(previousPageData) || !previousPageData.nextCursor) {
            return null
          }
        } else {
          // offset mode
          if (isCursorPaginatedResponse(previousPageData)) {
            // Response doesn't match expected mode
            return null
          }
          if (!previousPageData.hasNext) {
            return null
          }
        }
      }

      // Build pagination query
      const paginationQuery: Record<string, any> = {
        ...(options?.query as Record<string, any>),
        limit
      }

      if (mode === 'cursor' && previousPageData && isCursorPaginatedResponse(previousPageData)) {
        paginationQuery.cursor = previousPageData.nextCursor
      } else if (mode === 'offset') {
        paginationQuery.page = pageIndex + 1
      }

      return [path, paginationQuery] as [TPath, Record<string, any>]
    },
    [path, options?.query, limit, mode, enabled]
  )

  // Fetcher for infinite query - wraps getFetcher with proper types
  const infiniteFetcher = (key: [ConcreteApiPaths, Record<string, any>?]) => {
    return getFetcher(key) as Promise<PaginatedResponse<any>>
  }

  const swrResult = useSWRInfinite(getKey, infiniteFetcher, {
    // Default configuration
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 5000,
    errorRetryCount: 3,
    errorRetryInterval: 1000,
    initialSize: 1,
    revalidateAll: false,
    revalidateFirstPage: true,
    parallel: false,
    // User overrides
    ...options?.swrOptions
  })

  const { error, isLoading, isValidating, mutate, size, setSize } = swrResult
  const data = swrResult.data as PaginatedResponse<any>[] | undefined

  // Compute derived state
  const items = useMemo(() => data?.flatMap((p) => p.items) ?? [], [data])

  const hasNext = useMemo(() => {
    if (!data?.length) return false
    const last = data[data.length - 1]
    if (mode === 'cursor') {
      return isCursorPaginatedResponse(last) && !!last.nextCursor
    }
    return !isCursorPaginatedResponse(last) && (last as OffsetPaginatedResponse<any>).hasNext
  }, [data, mode])

  // Action methods
  const loadNext = useCallback(() => {
    if (!hasNext || isValidating) return
    setSize((s) => s + 1)
  }, [hasNext, isValidating, setSize])

  const refresh = useCallback(() => mutate(), [mutate])
  const reset = useCallback(() => setSize(1), [setSize])

  return {
    items,
    pages: data ?? [],
    total: data?.[0]?.total ?? 0,
    size,
    isLoading,
    isRefreshing: isValidating,
    error: error as Error | undefined,
    hasNext,
    loadNext,
    setSize,
    refresh,
    reset,
    mutate
  } as unknown as ResponseForPath<TPath, 'GET'> extends PaginatedResponse<infer T>
    ? {
        items: T[]
        pages: PaginatedResponse<T>[]
        total: number
        size: number
        isLoading: boolean
        isRefreshing: boolean
        error?: Error
        hasNext: boolean
        loadNext: () => void
        setSize: (size: number | ((size: number) => number)) => void
        refresh: () => void
        reset: () => void
        mutate: KeyedMutator<PaginatedResponse<T>[]>
      }
    : never
}

// ============================================================================
// Paginated Query Hook
// ============================================================================

/**
 * Options for usePaginatedQuery hook
 */
export interface UsePaginatedQueryOptions<TPath extends ConcreteApiPaths> {
  /** Additional query parameters (excluding pagination params) */
  query?: Omit<QueryParamsForPath<TPath>, 'page' | 'limit'>
  /** Items per page (default: 10) */
  limit?: number
  /** Whether to enable the query (default: true) */
  enabled?: boolean
  /** SWR options */
  swrOptions?: Parameters<typeof useSWR>[2]
}

/**
 * React hook for paginated data fetching with type safety
 * Automatically manages pagination state and provides navigation controls
 * Works with API endpoints that return PaginatedResponse<T>
 *
 * @template TPath - The concrete API path type
 * @param path - API endpoint path that returns paginated data (e.g., '/test/items')
 * @param options - Configuration options for pagination and filtering
 * @param options.query - Additional query parameters (excluding page/limit)
 * @param options.limit - Items per page (default: 10)
 * @param options.swrOptions - Additional SWR configuration options
 * @returns Object containing paginated data, navigation controls, and state
 *
 * @example
 * ```typescript
 * // Basic paginated list
 * const {
 *   items,
 *   loading,
 *   total,
 *   page,
 *   hasNext,
 *   nextPage,
 *   prevPage
 * } = usePaginatedQuery('/test/items', {
 *   limit: 20
 * })
 *
 * // With search and filtering
 * const paginatedItems = usePaginatedQuery('/test/items', {
 *   query: {
 *     search: searchTerm,
 *     status: 'active',
 *     type: 'premium'
 *   },
 *   limit: 25,
 *   swrOptions: {
 *     refreshInterval: 30000  // Refresh every 30 seconds
 *   }
 * })
 *
 * // Navigation controls usage
 * <div>
 *   <button onClick={prevPage} disabled={!hasPrev}>
 *     Previous
 *   </button>
 *   <span>Page {page} of {Math.ceil(total / 20)}</span>
 *   <button onClick={nextPage} disabled={!hasNext}>
 *     Next
 *   </button>
 * </div>
 *
 * // Reset pagination when search changes
 * useEffect(() => {
 *   reset()  // Go back to first page
 * }, [searchTerm])
 * ```
 */
export function usePaginatedQuery<TPath extends ConcreteApiPaths>(
  path: TPath,
  options?: {
    /** Additional query parameters (excluding pagination) */
    query?: Omit<QueryParamsForPath<TPath>, 'page' | 'limit'>
    /** Items per page (default: 10) */
    limit?: number
    /** Custom SWR options */
    swrOptions?: Parameters<typeof useSWR>[2]
  }
): ResponseForPath<TPath, 'GET'> extends PaginatedResponse<infer T>
  ? {
      /** Array of items for current page */
      items: T[]
      /** Total number of items across all pages */
      total: number
      /** Current page number (1-based) */
      page: number
      /** True during initial load (no data yet) */
      isLoading: boolean
      /** True during any request (including background refresh) */
      isRefreshing: boolean
      /** Error if request failed */
      error?: Error
      /** Whether there are more pages available */
      hasNext: boolean
      /** Whether there are previous pages available */
      hasPrev: boolean
      /** Navigate to previous page */
      prevPage: () => void
      /** Navigate to next page */
      nextPage: () => void
      /** Refresh current page data */
      refresh: () => void
      /** Reset to first page */
      reset: () => void
    }
  : never {
  const [currentPage, setCurrentPage] = useState(1)
  const limit = options?.limit || 10

  // Convert user's strongly-typed query with pagination for internal use
  const queryWithPagination = {
    ...options?.query,
    page: currentPage,
    limit
  } as Record<string, any>

  const { data, isLoading, isRefreshing, error, refetch } = useQuery(path, {
    query: queryWithPagination as QueryParamsForPath<TPath>,
    swrOptions: options?.swrOptions
  })

  // Extract paginated response data with type safety
  const paginatedData = data as PaginatedResponse<any>
  const items = paginatedData?.items || []
  const total = paginatedData?.total || 0
  const totalPages = Math.ceil(total / limit)

  const hasNext = currentPage < totalPages
  const hasPrev = currentPage > 1

  const nextPage = () => {
    if (hasNext) {
      setCurrentPage((prev) => prev + 1)
    }
  }

  const prevPage = () => {
    if (hasPrev) {
      setCurrentPage((prev) => prev - 1)
    }
  }

  const reset = () => {
    setCurrentPage(1)
  }

  return {
    items,
    total,
    page: currentPage,
    isLoading,
    isRefreshing,
    error,
    hasNext,
    hasPrev,
    prevPage,
    nextPage,
    refresh: refetch,
    reset
  } as ResponseForPath<TPath, 'GET'> extends PaginatedResponse<infer T>
    ? {
        items: T[]
        total: number
        page: number
        isLoading: boolean
        isRefreshing: boolean
        error?: Error
        hasNext: boolean
        hasPrev: boolean
        prevPage: () => void
        nextPage: () => void
        refresh: () => void
        reset: () => void
      }
    : never
}
