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

// ============================================================================
// Hook Result Types
// ============================================================================

/** Infer item type from paginated response path */
type InferPaginatedItem<TPath extends ConcreteApiPaths> = ResponseForPath<TPath, 'GET'> extends PaginatedResponse<
  infer T
>
  ? T
  : unknown

/** useQuery result type */
export interface UseQueryResult<TPath extends ConcreteApiPaths> {
  data?: ResponseForPath<TPath, 'GET'>
  isLoading: boolean
  isRefreshing: boolean
  error?: Error
  refetch: () => void
  mutate: KeyedMutator<ResponseForPath<TPath, 'GET'>>
}

/** useMutation result type */
export interface UseMutationResult<
  TPath extends ConcreteApiPaths,
  TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'
> {
  mutate: (data?: {
    body?: BodyForPath<TPath, TMethod>
    query?: QueryParamsForPath<TPath>
  }) => Promise<ResponseForPath<TPath, TMethod>>
  isLoading: boolean
  error: Error | undefined
}

/** useInfiniteQuery result type */
export interface UseInfiniteQueryResult<T> {
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

/** usePaginatedQuery result type */
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

// ============================================================================
// Utilities
// ============================================================================

/**
 * Unified API fetcher with type-safe method dispatching
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
 * Build SWR cache key from path and query
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
 */
function getFetcher<TPath extends ConcreteApiPaths>([path, query]: [TPath, Record<string, any>?]): Promise<
  ResponseForPath<TPath, 'GET'>
> {
  const apiFetcher = createApiFetcher('GET')
  return apiFetcher(path, { query })
}

/**
 * Data fetching hook with SWR caching and revalidation
 *
 * @example
 * const { data, isLoading, error } = useQuery('/items', { query: { page: 1 } })
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
): UseQueryResult<TPath> {
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
 * Mutation hook for POST, PUT, DELETE, PATCH operations
 *
 * @example
 * const { mutate, isLoading } = useMutation('POST', '/items', {
 *   onSuccess: (data) => console.log(data),
 *   revalidate: ['/items']
 * })
 * await mutate({ body: { title: 'New Item' } })
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
): UseMutationResult<TPath, TMethod> {
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
      await globalMutate(path, options.optimisticData, false)
    }

    try {
      const convertedData = data ? { body: data.body, query: data.query as Record<string, any> } : undefined

      const result = await trigger(convertedData)

      if (options?.optimistic) {
        await globalMutate(path)
      }

      return result
    } catch (err) {
      if (options?.optimistic && options?.optimisticData) {
        await globalMutate(path)
      }
      throw err
    }
  }

  const normalMutate = async (data?: {
    body?: BodyForPath<TPath, TMethod>
    query?: QueryParamsForPath<TPath>
  }): Promise<ResponseForPath<TPath, TMethod>> => {
    const convertedData = data ? { body: data.body, query: data.query as Record<string, any> } : undefined

    return trigger(convertedData)
  }

  return {
    mutate: options?.optimistic ? optimisticMutate : normalMutate,
    isLoading: isMutating,
    error
  }
}

/**
 * Hook to invalidate SWR cache entries
 *
 * @example
 * const invalidate = useInvalidateCache()
 * await invalidate('/items')        // specific key
 * await invalidate(['/a', '/b'])    // multiple keys
 * await invalidate(true)            // all keys
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
 * Prefetch data for warming up before user interactions
 *
 * @example
 * prefetch('/items', { query: { page: 1 } })
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
 * Infinite scrolling hook with cursor/offset pagination
 *
 * @example
 * const { items, hasNext, loadNext, isLoading } = useInfiniteQuery('/items', {
 *   limit: 20,
 *   mode: 'cursor'  // or 'offset'
 * })
 */
export function useInfiniteQuery<TPath extends ConcreteApiPaths>(
  path: TPath,
  options?: {
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
): UseInfiniteQueryResult<InferPaginatedItem<TPath>> {
  const limit = options?.limit ?? 10
  const mode = options?.mode ?? 'cursor' // Default: cursor mode
  const enabled = options?.enabled !== false

  const getKey = useCallback(
    (pageIndex: number, previousPageData: PaginatedResponse<any> | null) => {
      if (!enabled) return null

      if (previousPageData) {
        if (mode === 'cursor') {
          if (!isCursorPaginatedResponse(previousPageData) || !previousPageData.nextCursor) {
            return null
          }
        } else {
          if (isCursorPaginatedResponse(previousPageData)) {
            return null
          }
          if (!previousPageData.hasNext) {
            return null
          }
        }
      }

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

  const infiniteFetcher = (key: [ConcreteApiPaths, Record<string, any>?]) => {
    return getFetcher(key) as Promise<PaginatedResponse<any>>
  }

  const swrResult = useSWRInfinite(getKey, infiniteFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 5000,
    errorRetryCount: 3,
    errorRetryInterval: 1000,
    initialSize: 1,
    revalidateAll: false,
    revalidateFirstPage: true,
    parallel: false,
    ...options?.swrOptions
  })

  const { error, isLoading, isValidating, mutate, size, setSize } = swrResult
  const data = swrResult.data as PaginatedResponse<any>[] | undefined

  const items = useMemo(() => data?.flatMap((p) => p.items) ?? [], [data])

  const hasNext = useMemo(() => {
    if (!data?.length) return false
    const last = data[data.length - 1]
    if (mode === 'cursor') {
      return isCursorPaginatedResponse(last) && !!last.nextCursor
    }
    return !isCursorPaginatedResponse(last) && (last as OffsetPaginatedResponse<any>).hasNext
  }, [data, mode])

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
  } as UseInfiniteQueryResult<InferPaginatedItem<TPath>>
}

// ============================================================================
// Paginated Query Hook
// ============================================================================

/**
 * Paginated data fetching hook with navigation controls
 *
 * @example
 * const { items, page, hasNext, nextPage, prevPage } = usePaginatedQuery('/items', {
 *   limit: 20,
 *   query: { search: 'hello' }
 * })
 */
export function usePaginatedQuery<TPath extends ConcreteApiPaths>(
  path: TPath,
  options?: {
    /** Additional query parameters (excluding pagination params) */
    query?: Omit<QueryParamsForPath<TPath>, 'page' | 'limit'>
    /** Items per page (default: 10) */
    limit?: number
    /** SWR options */
    swrOptions?: Parameters<typeof useSWR>[2]
  }
): UsePaginatedQueryResult<InferPaginatedItem<TPath>> {
  const [currentPage, setCurrentPage] = useState(1)
  const limit = options?.limit || 10

  const queryWithPagination = {
    ...options?.query,
    page: currentPage,
    limit
  } as Record<string, any>

  const { data, isLoading, isRefreshing, error, refetch } = useQuery(path, {
    query: queryWithPagination as QueryParamsForPath<TPath>,
    swrOptions: options?.swrOptions
  })

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
  } as UsePaginatedQueryResult<InferPaginatedItem<TPath>>
}
