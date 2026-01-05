/**
 * @fileoverview React hooks for data fetching with SWR integration.
 *
 * This module provides type-safe hooks for interacting with the DataApi:
 *
 * - {@link useQuery} - Fetch data with automatic caching and revalidation
 * - {@link useMutation} - Perform POST/PUT/PATCH/DELETE operations
 * - {@link useInfiniteQuery} - Cursor-based infinite scrolling
 * - {@link usePaginatedQuery} - Offset-based pagination with navigation
 * - {@link useInvalidateCache} - Manual cache invalidation
 * - {@link prefetch} - Warm up cache before user interactions
 *
 * All hooks use SWR under the hood for caching, deduplication, and revalidation.
 *
 * @example
 * // Basic data fetching
 * const { data, isLoading } = useQuery('/topics')
 *
 * @example
 * // Create with auto-refresh
 * const { trigger } = useMutation('POST', '/topics', { refresh: ['/topics'] })
 * await trigger({ body: { name: 'New Topic' } })
 *
 * @see {@link https://swr.vercel.app SWR Documentation}
 */

import { dataApiService } from '@data/DataApiService'
import type { BodyForPath, QueryParamsForPath, ResponseForPath } from '@shared/data/api/apiPaths'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import {
  type CursorPaginationResponse,
  type OffsetPaginationResponse,
  type PaginationResponse
} from '@shared/data/api/apiTypes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyedMutator, SWRConfiguration } from 'swr'
import useSWR, { preload, useSWRConfig } from 'swr'
import type { SWRInfiniteConfiguration } from 'swr/infinite'
import useSWRInfinite from 'swr/infinite'
import type { SWRMutationConfiguration } from 'swr/mutation'
import useSWRMutation from 'swr/mutation'

/**
 * Default SWR configuration shared across all hooks.
 *
 * @remarks
 * - `revalidateOnFocus: false` - Prevents refetch when window regains focus
 * - `revalidateOnReconnect: true` - Refetch when network reconnects
 * - `dedupingInterval: 5000` - Dedupe requests within 5 seconds
 * - `errorRetryCount: 3` - Retry failed requests up to 3 times
 * - `errorRetryInterval: 1000` - Wait 1 second between retries
 */
const DEFAULT_SWR_OPTIONS = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 5000,
  errorRetryCount: 3,
  errorRetryInterval: 1000
} as const

// ============================================================================
// Hook Result Types
// ============================================================================

/** Infer item type from paginated response path */
type InferPaginatedItem<TPath extends ConcreteApiPaths> = ResponseForPath<TPath, 'GET'> extends PaginationResponse<
  infer T
>
  ? T
  : unknown

/**
 * useQuery result type
 * @property data - The fetched data, undefined while loading or on error
 * @property isLoading - True during initial load (no cached data)
 * @property isRefreshing - True during background revalidation (has cached data)
 * @property error - Error object if the request failed
 * @property refetch - Trigger a revalidation from the server
 * @property mutate - SWR mutator for advanced cache control (optimistic updates, manual cache manipulation)
 */
export interface UseQueryResult<TPath extends ConcreteApiPaths> {
  data?: ResponseForPath<TPath, 'GET'>
  isLoading: boolean
  isRefreshing: boolean
  error?: Error
  refetch: () => void
  mutate: KeyedMutator<ResponseForPath<TPath, 'GET'>>
}

/**
 * useMutation result type
 * @property trigger - Execute the mutation with optional body and query params
 * @property isLoading - True while the mutation is in progress
 * @property error - Error object if the last mutation failed
 */
export interface UseMutationResult<
  TPath extends ConcreteApiPaths,
  TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'
> {
  trigger: (data?: {
    body?: BodyForPath<TPath, TMethod>
    query?: QueryParamsForPath<TPath>
  }) => Promise<ResponseForPath<TPath, TMethod>>
  isLoading: boolean
  error: Error | undefined
}

/**
 * useInfiniteQuery result type (cursor-based pagination)
 * @property items - All loaded items flattened from all pages
 * @property isLoading - True during initial load
 * @property isRefreshing - True during background revalidation
 * @property error - Error object if the request failed
 * @property hasNext - True if more pages are available (nextCursor exists)
 * @property loadNext - Load the next page of items
 * @property refresh - Revalidate all loaded pages from the server
 * @property reset - Reset to first page only
 * @property mutate - SWR mutator for advanced cache control
 */
export interface UseInfiniteQueryResult<T> {
  items: T[]
  isLoading: boolean
  isRefreshing: boolean
  error?: Error
  hasNext: boolean
  loadNext: () => void
  refresh: () => void
  reset: () => void
  mutate: KeyedMutator<CursorPaginationResponse<T>[]>
}

/**
 * usePaginatedQuery result type (offset-based pagination)
 * @property items - Items on the current page
 * @property total - Total number of items across all pages
 * @property page - Current page number (1-indexed)
 * @property isLoading - True during initial load
 * @property isRefreshing - True during background revalidation
 * @property error - Error object if the request failed
 * @property hasNext - True if next page exists
 * @property hasPrev - True if previous page exists (page > 1)
 * @property prevPage - Navigate to previous page
 * @property nextPage - Navigate to next page
 * @property refresh - Revalidate current page from the server
 * @property reset - Reset to page 1
 */
export interface UsePaginatedQueryResult<T> {
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

/**
 * Data fetching hook with SWR caching and revalidation.
 *
 * Features:
 * - Automatic caching and deduplication
 * - Background revalidation on focus/reconnect
 * - Error retry with exponential backoff
 *
 * @param path - API endpoint path (e.g., '/topics', '/messages')
 * @param options - Query options
 * @param options.query - Query parameters for filtering, pagination, etc.
 * @param options.enabled - Set to false to disable the request (default: true)
 * @param options.swrOptions - Override default SWR configuration
 * @returns Query result with data, loading states, and cache controls
 *
 * @example
 * // Basic usage
 * const { data, isLoading, error } = useQuery('/topics')
 *
 * @example
 * // With query parameters
 * const { data } = useQuery('/messages', { query: { topicId: 'abc', limit: 20 } })
 *
 * @example
 * // Conditional fetching
 * const { data } = useQuery('/topics', { enabled: !!userId })
 *
 * @example
 * // Manual cache update
 * const { data, mutate } = useQuery('/topics')
 * mutate({ ...data, name: 'Updated' }, { revalidate: false })
 */
export function useQuery<TPath extends ConcreteApiPaths>(
  path: TPath,
  options?: {
    /** Query parameters for filtering, pagination, etc. */
    query?: QueryParamsForPath<TPath>
    /** Disable the request (default: true) */
    enabled?: boolean
    /** Override default SWR configuration */
    swrOptions?: SWRConfiguration
  }
): UseQueryResult<TPath> {
  const key = options?.enabled !== false ? buildSWRKey(path, options?.query) : null

  const { data, error, isLoading, isValidating, mutate } = useSWR(key, getFetcher, {
    ...DEFAULT_SWR_OPTIONS,
    ...options?.swrOptions
  })

  const refetch = useCallback(() => mutate(), [mutate])

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
 * Mutation hook for POST, PUT, DELETE, PATCH operations.
 *
 * Features:
 * - Automatic cache invalidation via refresh option
 * - Optimistic updates with automatic rollback on error
 * - Success/error callbacks
 *
 * @param method - HTTP method ('POST' | 'PUT' | 'DELETE' | 'PATCH')
 * @param path - API endpoint path
 * @param options - Mutation options
 * @param options.onSuccess - Callback when mutation succeeds
 * @param options.onError - Callback when mutation fails
 * @param options.refresh - API paths to revalidate on success
 * @param options.optimisticData - If provided, updates cache immediately before request completes
 * @param options.swrOptions - Override SWR mutation configuration
 * @returns Mutation result with trigger function and loading state
 *
 * @example
 * // Basic POST
 * const { trigger, isLoading } = useMutation('POST', '/topics')
 * await trigger({ body: { name: 'New Topic' } })
 *
 * @example
 * // With auto-refresh and callbacks
 * const { trigger } = useMutation('POST', '/topics', {
 *   refresh: ['/topics'],
 *   onSuccess: (data) => toast.success('Created!'),
 *   onError: (error) => toast.error(error.message)
 * })
 *
 * @example
 * // Optimistic update (UI updates immediately, rolls back on error)
 * const { trigger } = useMutation('PATCH', '/topics/abc', {
 *   optimisticData: { ...topic, starred: true }
 * })
 */
export function useMutation<TPath extends ConcreteApiPaths, TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'>(
  method: TMethod,
  path: TPath,
  options?: {
    /** Callback when mutation succeeds */
    onSuccess?: (data: ResponseForPath<TPath, TMethod>) => void
    /** Callback when mutation fails */
    onError?: (error: Error) => void
    /** API paths to revalidate on success */
    refresh?: ConcreteApiPaths[]
    /** If provided, updates cache immediately (with auto-rollback on error) */
    optimisticData?: ResponseForPath<TPath, TMethod>
    /** Override SWR mutation configuration (fetcher, onSuccess, onError are handled internally) */
    swrOptions?: Omit<
      SWRMutationConfiguration<ResponseForPath<TPath, TMethod>, Error>,
      'fetcher' | 'onSuccess' | 'onError'
    >
  }
): UseMutationResult<TPath, TMethod> {
  const { mutate: globalMutate } = useSWRConfig()

  // Use ref to avoid stale closure issues with callbacks
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const apiFetcher = createApiFetcher<TPath, TMethod>(method)

  const fetcher = async (
    _key: string,
    {
      arg
    }: {
      arg?: {
        body?: BodyForPath<TPath, TMethod>
        query?: QueryParamsForPath<TPath>
      }
    }
  ): Promise<ResponseForPath<TPath, TMethod>> => {
    return apiFetcher(path, { body: arg?.body, query: arg?.query })
  }

  const {
    trigger: swrTrigger,
    isMutating,
    error
  } = useSWRMutation(path as string, fetcher, {
    populateCache: false,
    revalidate: false,
    onSuccess: async (data) => {
      optionsRef.current?.onSuccess?.(data)

      // Refresh specified keys on success
      if (optionsRef.current?.refresh?.length) {
        await Promise.all(optionsRef.current.refresh.map((key) => globalMutate(key)))
      }
    },
    onError: (error) => optionsRef.current?.onError?.(error),
    ...options?.swrOptions
  })

  const trigger = async (data?: {
    body?: BodyForPath<TPath, TMethod>
    query?: QueryParamsForPath<TPath>
  }): Promise<ResponseForPath<TPath, TMethod>> => {
    const opts = optionsRef.current
    const hasOptimisticData = opts?.optimisticData !== undefined

    // Apply optimistic update if optimisticData is provided
    if (hasOptimisticData) {
      await globalMutate(path, opts!.optimisticData, false)
    }

    try {
      const result = await swrTrigger(data)

      // Revalidate after optimistic update completes
      if (hasOptimisticData) {
        await globalMutate(path)
      }

      return result
    } catch (err) {
      // Rollback optimistic update on error
      if (hasOptimisticData) {
        await globalMutate(path)
      }
      throw err
    }
  }

  return {
    trigger,
    isLoading: isMutating,
    error
  }
}

/**
 * Hook to invalidate SWR cache entries and trigger revalidation.
 *
 * Use this to manually clear cached data and force a fresh fetch.
 *
 * @returns Invalidate function that accepts keys to invalidate
 *
 * @example
 * const invalidate = useInvalidateCache()
 *
 * // Invalidate specific path
 * await invalidate('/topics')
 *
 * // Invalidate multiple paths
 * await invalidate(['/topics', '/messages'])
 *
 * // Invalidate all cached data
 * await invalidate(true)
 */
export function useInvalidateCache() {
  const { mutate } = useSWRConfig()

  const invalidate = async (keys?: string | string[] | boolean): Promise<void> => {
    if (keys === true || keys === undefined) {
      await mutate(() => true)
    } else if (typeof keys === 'string') {
      await mutate(keys)
    } else if (Array.isArray(keys)) {
      await Promise.all(keys.map((key) => mutate(key)))
    }
  }

  return invalidate
}

/**
 * Prefetch data to warm up the cache before user interactions.
 *
 * Uses SWR preload to fetch and cache data. Subsequent useQuery calls
 * with the same path and query will use the cached data immediately.
 *
 * @param path - API endpoint path to prefetch
 * @param options - Prefetch options
 * @param options.query - Query parameters (must match useQuery call)
 * @returns Promise resolving to the fetched data
 *
 * @example
 * // Prefetch on hover
 * onMouseEnter={() => prefetch('/topics/abc')}
 *
 * @example
 * // Prefetch with query params
 * await prefetch('/messages', { query: { topicId: 'abc', limit: 20 } })
 * // Later, this will be instant:
 * const { data } = useQuery('/messages', { query: { topicId: 'abc', limit: 20 } })
 */
export function prefetch<TPath extends ConcreteApiPaths>(
  path: TPath,
  options?: {
    query?: QueryParamsForPath<TPath>
  }
): Promise<ResponseForPath<TPath, 'GET'>> {
  const key = buildSWRKey(path, options?.query)
  return preload(key, getFetcher)
}

// ============================================================================
// Infinite Query Hook
// ============================================================================

/**
 * Infinite scrolling hook with cursor-based pagination.
 *
 * Automatically loads pages using cursor tokens. Items from all loaded pages
 * are flattened into a single array for easy rendering.
 *
 * @param path - API endpoint path (must return CursorPaginationResponse)
 * @param options - Infinite query options
 * @param options.query - Additional query parameters (cursor/limit are managed internally)
 * @param options.limit - Items per page (default: 10)
 * @param options.enabled - Set to false to disable fetching (default: true)
 * @param options.swrOptions - Override SWR infinite configuration
 * @returns Infinite query result with items, pagination controls, and loading states
 *
 * @example
 * // Basic infinite scroll
 * const { items, hasNext, loadNext, isLoading } = useInfiniteQuery('/messages')
 *
 * return (
 *   <div>
 *     {items.map(item => <Item key={item.id} {...item} />)}
 *     {hasNext && <button onClick={loadNext}>Load More</button>}
 *   </div>
 * )
 *
 * @example
 * // With filters and custom limit
 * const { items, loadNext } = useInfiniteQuery('/messages', {
 *   query: { topicId: 'abc' },
 *   limit: 50
 * })
 */
export function useInfiniteQuery<TPath extends ConcreteApiPaths>(
  path: TPath,
  options?: {
    /** Additional query parameters (cursor/limit are managed internally) */
    query?: Omit<QueryParamsForPath<TPath>, 'cursor' | 'limit'>
    /** Items per page (default: 10) */
    limit?: number
    /** Set to false to disable fetching (default: true) */
    enabled?: boolean
    /** Override SWR infinite configuration */
    swrOptions?: SWRInfiniteConfiguration
  }
): UseInfiniteQueryResult<InferPaginatedItem<TPath>> {
  const limit = options?.limit ?? 10
  const enabled = options?.enabled !== false

  const getKey = useCallback(
    (_pageIndex: number, previousPageData: CursorPaginationResponse<unknown> | null) => {
      if (!enabled) return null

      // Stop if previous page has no nextCursor
      if (previousPageData && !previousPageData.nextCursor) {
        return null
      }

      const paginationQuery = {
        ...options?.query,
        limit,
        ...(previousPageData?.nextCursor ? { cursor: previousPageData.nextCursor } : {})
      }

      return [path, paginationQuery] as [TPath, typeof paginationQuery]
    },
    [path, options?.query, limit, enabled]
  )

  const infiniteFetcher = (key: [TPath, Record<string, unknown>]) => {
    return getFetcher(key as unknown as [TPath, QueryParamsForPath<TPath>?]) as Promise<
      CursorPaginationResponse<InferPaginatedItem<TPath>>
    >
  }

  const swrResult = useSWRInfinite(getKey, infiniteFetcher, {
    ...DEFAULT_SWR_OPTIONS,
    ...options?.swrOptions
  })

  const { error, isLoading, isValidating, mutate, setSize } = swrResult
  const data = swrResult.data as CursorPaginationResponse<InferPaginatedItem<TPath>>[] | undefined

  const items = useMemo(() => data?.flatMap((p) => p.items) ?? [], [data])

  const hasNext = useMemo(() => {
    if (!data?.length) return false
    const last = data[data.length - 1]
    return !!last.nextCursor
  }, [data])

  const loadNext = useCallback(() => {
    if (!hasNext || isValidating) return
    setSize((s) => s + 1)
  }, [hasNext, isValidating, setSize])

  const refresh = useCallback(() => mutate(), [mutate])
  const reset = useCallback(() => setSize(1), [setSize])

  return {
    items,
    isLoading,
    isRefreshing: isValidating,
    error: error as Error | undefined,
    hasNext,
    loadNext,
    refresh,
    reset,
    mutate
  }
}

// ============================================================================
// Paginated Query Hook
// ============================================================================

/**
 * Paginated data fetching hook with offset-based navigation.
 *
 * Provides page-by-page navigation with previous/next controls.
 * Automatically resets to page 1 when query parameters change.
 *
 * @param path - API endpoint path (must return OffsetPaginationResponse)
 * @param options - Pagination options
 * @param options.query - Additional query parameters (page/limit are managed internally)
 * @param options.limit - Items per page (default: 10)
 * @param options.enabled - Set to false to disable fetching (default: true)
 * @param options.swrOptions - Override SWR configuration
 * @returns Paginated query result with items, page info, and navigation controls
 *
 * @example
 * // Basic pagination
 * const { items, page, hasNext, hasPrev, nextPage, prevPage } = usePaginatedQuery('/topics')
 *
 * return (
 *   <div>
 *     {items.map(item => <Item key={item.id} {...item} />)}
 *     <button onClick={prevPage} disabled={!hasPrev}>Prev</button>
 *     <span>Page {page}</span>
 *     <button onClick={nextPage} disabled={!hasNext}>Next</button>
 *   </div>
 * )
 *
 * @example
 * // With search filter
 * const { items, total } = usePaginatedQuery('/topics', {
 *   query: { search: searchTerm },
 *   limit: 20
 * })
 */
export function usePaginatedQuery<TPath extends ConcreteApiPaths>(
  path: TPath,
  options?: {
    /** Additional query parameters (page/limit are managed internally) */
    query?: Omit<QueryParamsForPath<TPath>, 'page' | 'limit'>
    /** Items per page (default: 10) */
    limit?: number
    /** Set to false to disable fetching (default: true) */
    enabled?: boolean
    /** Override SWR configuration */
    swrOptions?: SWRConfiguration
  }
): UsePaginatedQueryResult<InferPaginatedItem<TPath>> {
  const [currentPage, setCurrentPage] = useState(1)
  const limit = options?.limit || 10

  // Reset page to 1 when query parameters change
  const queryKey = JSON.stringify(options?.query)
  useEffect(() => {
    setCurrentPage(1)
  }, [queryKey])

  // Build query with pagination params
  const queryWithPagination = {
    ...options?.query,
    page: currentPage,
    limit
  }

  const { data, isLoading, isRefreshing, error, refetch } = useQuery(path, {
    // Type assertion needed: we're adding pagination params to a partial query type
    query: queryWithPagination as QueryParamsForPath<TPath>,
    enabled: options?.enabled,
    swrOptions: options?.swrOptions
  })

  // usePaginatedQuery is only for offset pagination
  const paginatedData = data as OffsetPaginationResponse<any> | undefined
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
  } as UsePaginatedQueryResult<InferPaginatedItem<TPath>>
}

// ============================================================================
// Internal Utilities
// ============================================================================

/**
 * Create a type-safe API fetcher for the specified HTTP method.
 *
 * @internal
 * @param method - HTTP method to use
 * @returns Async function that makes the API request
 *
 * @remarks
 * Type assertion at dataApiService boundary is intentional since dataApiService
 * accepts 'any' for maximum flexibility.
 */
function createApiFetcher<TPath extends ConcreteApiPaths, TMethod extends 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>(
  method: TMethod
) {
  return async (
    path: TPath,
    options?: {
      body?: BodyForPath<TPath, TMethod>
      query?: QueryParamsForPath<TPath>
    }
  ): Promise<ResponseForPath<TPath, TMethod>> => {
    // Internal type assertion for dataApiService boundary (accepts any)
    const query = options?.query as Record<string, unknown> | undefined
    switch (method) {
      case 'GET':
        return dataApiService.get(path, { query })
      case 'POST':
        return dataApiService.post(path, { body: options?.body, query })
      case 'PUT':
        return dataApiService.put(path, { body: options?.body || {}, query })
      case 'DELETE':
        return dataApiService.delete(path, { query })
      case 'PATCH':
        return dataApiService.patch(path, { body: options?.body, query })
      default:
        throw new Error(`Unsupported method: ${method}`)
    }
  }
}

/**
 * Build SWR cache key from path and optional query parameters.
 *
 * @internal
 * @param path - API endpoint path
 * @param query - Optional query parameters
 * @returns Tuple of [path] or [path, query] for SWR cache key
 */
function buildSWRKey<TPath extends ConcreteApiPaths, TQuery extends QueryParamsForPath<TPath>>(
  path: TPath,
  query?: TQuery
): [TPath] | [TPath, TQuery] {
  if (query && Object.keys(query).length > 0) {
    return [path, query]
  }

  return [path]
}

/**
 * SWR fetcher function for GET requests.
 *
 * @internal
 * @param key - SWR cache key tuple [path, query?]
 * @returns Promise resolving to the API response
 */
function getFetcher<TPath extends ConcreteApiPaths>([path, query]: [TPath, QueryParamsForPath<TPath>?]): Promise<
  ResponseForPath<TPath, 'GET'>
> {
  const apiFetcher = createApiFetcher<TPath, 'GET'>('GET')
  return apiFetcher(path, { query })
}
