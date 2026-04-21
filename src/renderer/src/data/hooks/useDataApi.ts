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
 * - {@link useReadCache} - Non-reactive cache peek (single sanctioned home for `unstable_serialize`)
 * - {@link useWriteCache} - Write to a cache key without revalidating (optimistic overlay)
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
 * @example
 * // Template path + `/*` prefix refresh (delete any topic, invalidate the whole resource tree)
 * const { trigger } = useMutation('DELETE', '/topics/:topicId', {
 *   refresh: ({ args }) => ['/topics', `/topics/${args.params.topicId}/*`]
 * })
 * await trigger({ params: { topicId: clickedId } })
 *
 * @see {@link https://swr.vercel.app SWR Documentation}
 */

import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { isDev } from '@renderer/config/constant'
import type {
  ApiPath,
  BodyForPath,
  ParamsForPath,
  QueryParamsForPath,
  ResponseForPath,
  TemplateApiPaths
} from '@shared/data/api/apiPaths'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import {
  type CursorPaginationResponse,
  type OffsetPaginationResponse,
  type PaginationResponse
} from '@shared/data/api/apiTypes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyedMutator, SWRConfiguration } from 'swr'
import useSWR, { preload, unstable_serialize, useSWRConfig } from 'swr'
import type { SWRInfiniteConfiguration } from 'swr/infinite'
import useSWRInfinite from 'swr/infinite'
import type { SWRMutationConfiguration } from 'swr/mutation'
import useSWRMutation from 'swr/mutation'

const logger = loggerService.withContext('useDataApi')

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
type InferPaginatedItem<TPath extends ApiPath> = ResponseForPath<TPath, 'GET'> extends PaginationResponse<infer T>
  ? T
  : unknown

/**
 * Map a path to the shape of its `params` option.
 *
 * - Template paths (literal `keyof ApiSchemas`) whose schema method declares
 *   `params: {...}` → `params` is required with the declared shape.
 * - Template paths whose method declares no `params` → `params` is forbidden.
 * - Pre-resolved concrete paths (like `/providers/abc`) → `params` is always
 *   forbidden, because the caller already inlined the values.
 *
 * Uses `[T] extends [never]` tuple-wrap to disable distributive conditional
 * evaluation over unions.
 */
export type ParamsOption<TPath extends string, TMethod extends string> = TPath extends TemplateApiPaths
  ? [ParamsForPath<TPath, TMethod>] extends [never]
    ? { params?: never }
    : { params: ParamsForPath<TPath, TMethod> }
  : { params?: never }

/**
 * useQuery result type
 * @property data - The fetched data, undefined while loading or on error
 * @property isLoading - True during initial load (no cached data)
 * @property isRefreshing - True during background revalidation (has cached data)
 * @property error - Error object if the request failed
 * @property refetch - Trigger a revalidation from the server
 * @property mutate - SWR mutator for advanced cache control (optimistic updates, manual cache manipulation)
 */
export interface UseQueryResult<TPath extends ApiPath> {
  data?: ResponseForPath<TPath, 'GET'>
  isLoading: boolean
  isRefreshing: boolean
  error?: Error
  refetch: () => void
  mutate: KeyedMutator<ResponseForPath<TPath, 'GET'>>
}

/**
 * Arguments accepted by the mutation `trigger` function.
 *
 * `params` is required for template paths (like `/providers/:providerId`) and
 * forbidden for pre-resolved concrete paths — the distinction is enforced at
 * the type level via {@link ParamsOption}.
 */
export type TriggerArgs<TPath extends ApiPath, TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'> = ParamsOption<
  TPath,
  TMethod
> & {
  body?: BodyForPath<TPath, TMethod>
  query?: QueryParamsForPath<TPath, TMethod>
}

/**
 * Context passed to a function-form `refresh` callback.
 */
export interface RefreshContext<TPath extends ApiPath, TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'> {
  /** The args passed to the current `trigger(...)` call */
  args: TriggerArgs<TPath, TMethod> | undefined
  /** The server response from this mutation */
  result: ResponseForPath<TPath, TMethod>
}

/**
 * `refresh` option shape: either a static array of paths (supporting `/*`
 * prefix matching) or a function computing paths from the trigger args and
 * server response.
 */
export type RefreshOption<TPath extends ApiPath, TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'> =
  | ConcreteApiPaths[]
  | ((ctx: RefreshContext<TPath, TMethod>) => ConcreteApiPaths[])

/**
 * useMutation result type
 * @property trigger - Execute the mutation with optional params, body, query
 * @property isLoading - True while the mutation is in progress
 * @property error - Error object if the last mutation failed
 */
export interface UseMutationResult<TPath extends ApiPath, TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'> {
  trigger: (data?: TriggerArgs<TPath, TMethod>) => Promise<ResponseForPath<TPath, TMethod>>
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
 *
 * @example
 * // Template path + params (prefer a helper like `providerPath(id)` when the id is stable)
 * const { data } = useQuery('/providers/:providerId', { params: { providerId } })
 */
export function useQuery<TPath extends ApiPath>(
  path: TPath,
  options?: ParamsOption<TPath, 'GET'> & {
    /** Query parameters for filtering, pagination, etc. */
    query?: QueryParamsForPath<TPath, 'GET'>
    /** Disable the request (default: true) */
    enabled?: boolean
    /** Override default SWR configuration */
    swrOptions?: SWRConfiguration
  }
): UseQueryResult<TPath> {
  const resolvedPath = resolveTemplate(path, options?.params as Record<string, string | number> | undefined)
  const key =
    options?.enabled !== false ? buildSWRKey(resolvedPath, options?.query as Record<string, any> | undefined) : null

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
 *
 * @example
 * // `/*` prefix in refresh invalidates all sub-paths of a resource (including unknown ids)
 * useMutation('DELETE', '/providers/:providerId', {
 *   refresh: ({ args }) => ['/providers', `/providers/${args.params.providerId}/*`]
 * })
 *
 * @example
 * // Function-form refresh when the invalidated keys depend on the server response
 * useMutation('POST', '/messages', {
 *   refresh: ({ result }) => [`/topics/${result.topicId}/messages`, `/messages/${result.parentId}`]
 * })
 *
 * @remarks
 * Template paths (e.g., `/topics/:topicId`) share SWR mutation state across all
 * `params` triggered on the same hook instance. Don't trigger different ids
 * concurrently from one hook — use per-row instances bound to concrete paths
 * (e.g., `useMutation('PATCH', providerPath(id))`) when you need parallel writes.
 *
 * @remarks
 * Callback / side-effect ordering after a successful mutation:
 * 1. Server response resolves.
 * 2. `refresh` keys are invalidated via `globalMutate`.
 * 3. `onSuccess` callback runs. Any `useQuery` the callback touches will be
 *    in "stale, pending revalidation" state — avoid manual optimistic
 *    `mutate(...)` here as it races with the pending revalidation.
 * 4. If `optimisticData` was set, the mutated cache key is re-validated.
 * A thrown `refresh` callback is caught and logged; it does not cause the
 * `trigger` promise to reject or skip `onSuccess`.
 */
export function useMutation<TPath extends ApiPath, TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'>(
  method: TMethod,
  path: TPath,
  options?: {
    /** Callback when mutation succeeds */
    onSuccess?: (data: ResponseForPath<TPath, TMethod>) => void
    /** Callback when mutation fails */
    onError?: (error: Error) => void
    /** API paths to revalidate on success; supports trailing `/*` for prefix match or a function of trigger args/result */
    refresh?: RefreshOption<TPath, TMethod>
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

  // Track the params from the most recent in-flight trigger, for dev-mode
  // concurrency detection on template paths.
  const inFlightParamsRef = useRef<Record<string, unknown> | null>(null)

  const apiFetcher = createApiFetcher<ConcreteApiPaths, TMethod>(method)

  // Fetcher resolves the template using the arg's `params` so the outgoing
  // request hits the concrete URL. The SWR mutation key (the template itself)
  // stays stable across triggers, which is what SWR needs for hook identity.
  const fetcher = async (
    templatePath: string,
    {
      arg
    }: {
      arg?: {
        params?: Record<string, string | number>
        body?: BodyForPath<TPath, TMethod>
        query?: QueryParamsForPath<TPath, TMethod>
      }
    }
  ): Promise<ResponseForPath<TPath, TMethod>> => {
    const resolvedPath = resolveTemplate(templatePath, arg?.params)
    return apiFetcher(resolvedPath as ConcreteApiPaths, {
      body: arg?.body as BodyForPath<ConcreteApiPaths, TMethod>,
      query: arg?.query as QueryParamsForPath<ConcreteApiPaths, TMethod>
    }) as Promise<ResponseForPath<TPath, TMethod>>
  }

  // SWR mutation state is cached by path; for template paths this means a
  // single hook instance shares `isMutating`/`error` across all params. See the
  // "Template paths and concurrent trigger" caveat in the renderer docs.
  const {
    trigger: swrTrigger,
    isMutating,
    error
    // SWR's MutationFetcher generic over TPath + ExtraArg doesn't infer cleanly
    // here (our ExtraArg shape mixes schema-derived body/query types), so we
    // widen the key to `string` for SWR while keeping TPath precision elsewhere.
  } = useSWRMutation(path as string, fetcher, {
    populateCache: false,
    revalidate: false,
    onError: (err) => optionsRef.current?.onError?.(err),
    ...options?.swrOptions
  })

  const trigger = async (data?: TriggerArgs<TPath, TMethod>): Promise<ResponseForPath<TPath, TMethod>> => {
    const opts = optionsRef.current
    // Capture args in this call's closure so concurrent triggers don't clobber
    // each other's refresh context (refs would race on overlapping awaits).
    const capturedArgs = data
    const paramsRecord = capturedArgs?.params as Record<string, string | number> | undefined
    const resolvedPath = resolveTemplate(path, paramsRecord)
    const hasOptimisticData = opts?.optimisticData !== undefined

    // Dev-mode: warn when a single template-hook instance is trigger'd with
    // different params while a previous call is still in-flight. We check the
    // ref rather than SWR's `isMutating` because React state updates lag a
    // render — synchronous bursts (e.g. `Promise.all([trigger(a), trigger(b)])`)
    // would see stale `isMutating === false` in both closures and the warning
    // would never fire. The ref is updated synchronously on trigger entry.
    if (isDev && paramsRecord) {
      const prev = inFlightParamsRef.current
      if (prev && JSON.stringify(prev) !== JSON.stringify(paramsRecord)) {
        logger.warn(
          `Concurrent trigger on template useMutation: ${method} ${String(path)}. ` +
            `In-flight params=${JSON.stringify(prev)}, new params=${JSON.stringify(paramsRecord)}. ` +
            `isMutating/error state will be shared between the two calls. ` +
            `Use per-row hook instances with concrete paths (e.g. useMutation('${method}', providerPath(id))) for parallel writes.`
        )
      }
    }
    inFlightParamsRef.current = paramsRecord ?? null

    // Apply optimistic update if optimisticData is provided
    if (hasOptimisticData) {
      await globalMutate([resolvedPath], opts.optimisticData, false)
    }

    try {
      const result = await swrTrigger({
        params: paramsRecord,
        body: capturedArgs?.body,
        query: capturedArgs?.query
      } as {
        params?: Record<string, string | number>
        body?: BodyForPath<TPath, TMethod>
        query?: QueryParamsForPath<TPath, TMethod>
      })

      // Run refresh after the mutation resolves. We do this in `trigger`
      // itself (not SWR's onSuccess) so args/result are closure-captured
      // and tied to this specific call.
      //
      // Refresh is an after-success side effect, not part of the mutation's
      // success contract. If a user-provided function-form refresh throws
      // (e.g. dereferences a missing arg), or if SWR revalidation surfaces
      // an error, we must NOT propagate it — the server-side mutation has
      // already succeeded and the caller's `await trigger()` must resolve
      // accordingly. Log and continue instead.
      const refreshOpt = opts?.refresh
      if (refreshOpt) {
        try {
          const keys = typeof refreshOpt === 'function' ? refreshOpt({ args: capturedArgs, result }) : refreshOpt
          if (keys.length > 0) {
            await globalMutate(createMultiKeyMatcher(keys))
          }
        } catch (refreshErr) {
          logger.warn(`Refresh failed after successful ${method} ${String(path)}; cache may be stale`, {
            error: refreshErr
          })
        }
      }

      opts?.onSuccess?.(result)

      // Revalidate after optimistic update completes
      if (hasOptimisticData) {
        await globalMutate([resolvedPath])
      }

      return result
    } catch (err) {
      // Rollback optimistic update on error
      if (hasOptimisticData) {
        await globalMutate([resolvedPath])
      }
      throw err
    } finally {
      if (inFlightParamsRef.current === paramsRecord) {
        inFlightParamsRef.current = null
      }
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
 *
 * @example
 * // `/*` prefix invalidates all sub-paths of a resource
 * await invalidate('/providers/*')
 * await invalidate(['/providers', '/providers/*'])
 */
export function useInvalidateCache() {
  const { mutate } = useSWRConfig()

  const invalidate = async (keys?: string | string[] | boolean): Promise<void> => {
    if (keys === true || keys === undefined) {
      await mutate(() => true)
    } else if (typeof keys === 'string') {
      await mutate(createKeyMatcher(keys))
    } else if (Array.isArray(keys)) {
      await mutate(createMultiKeyMatcher(keys))
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
 *
 * @example
 * // Template path + params — produces the same cache key as useQuery('/providers/:id', {...})
 * await prefetch('/providers/:providerId', { params: { providerId } })
 */
export function prefetch<TPath extends ApiPath>(
  path: TPath,
  options?: ParamsOption<TPath, 'GET'> & {
    query?: QueryParamsForPath<TPath, 'GET'>
  }
): Promise<ResponseForPath<TPath, 'GET'>> {
  const resolvedPath = resolveTemplate(path, options?.params as Record<string, string | number> | undefined)
  const key = buildSWRKey(resolvedPath, options?.query as Record<string, any> | undefined)
  return preload(key, getFetcher)
}

/**
 * Hook: snapshot-read a cached GET response WITHOUT subscribing.
 *
 * Returns a reader function that peeks the current value of a cache key and
 * returns `undefined` when the key has not been fetched yet. The reader does
 * NOT subscribe — calling it does not re-render the component when the cache
 * entry changes.
 *
 * Use this for one-shot reads inside callbacks or optimistic-update reducers
 * where re-rendering on cache change is explicitly undesirable (e.g.
 * {@link useMutation} callbacks, drag-and-drop optimistic writes). For
 * reactive access, use {@link useQuery} instead.
 *
 * This hook is the ONLY sanctioned place in the codebase to reach for SWR's
 * internal key serialization (`unstable_serialize`) and raw cache API — any
 * other hook that needs non-reactive cache reads must go through here so the
 * unstable-surface stays confined to a single file.
 *
 * @example
 * // Inside a callback, peek the current collection before computing an
 * // optimistic overlay.
 * const readSnapshot = useReadCache()
 * const handleDrop = (next: Item[]) => {
 *   const current = readSnapshot<{ items: Item[] }>('/mcp-servers')
 *   // ...derive optimistic value from current + next
 * }
 */
export function useReadCache() {
  const { cache } = useSWRConfig()

  return useCallback(
    <TResponse = unknown>(
      path: ConcreteApiPaths | TemplateApiPaths,
      query?: Record<string, unknown>
    ): TResponse | undefined => {
      const hasQuery = query !== undefined && Object.keys(query).length > 0
      const serialized = hasQuery ? unstable_serialize([path, query]) : unstable_serialize([path])
      const entry = cache.get(serialized)
      return entry?.data as TResponse | undefined
    },
    [cache]
  )
}

/**
 * Hook: write a value into the cache under a GET key WITHOUT triggering a
 * revalidation.
 *
 * Returns a writer function that mirrors {@link useQuery}'s cache-key shape
 * — pass the same `path` (+ optional `query`) you would to `useQuery` and it
 * overwrites that entry in-place. This is the sanctioned form of
 * `mutate(key, value, false)` for the DataApi layer; `useReorder` and any
 * future hook needing to seed an optimistic overlay go through here instead
 * of touching `useSWRConfig` directly.
 *
 * The write does NOT mark the entry stale and does NOT schedule a fetch —
 * callers who need a follow-up revalidate use {@link useInvalidateCache} or
 * rely on {@link useMutation}'s `refresh` option to handle it.
 *
 * @example
 * const writeCache = useWriteCache()
 * const invalidate = useInvalidateCache()
 *
 * // Seed an optimistic value derived from the current cache + user input.
 * await writeCache('/mcp-servers', nextCollection)
 * try {
 *   await patchServer({ body })
 * } catch (err) {
 *   // Rollback: force server truth back into cache.
 *   await invalidate('/mcp-servers')
 *   throw err
 * }
 */
export function useWriteCache() {
  const { mutate } = useSWRConfig()

  return useCallback(
    async <TResponse = unknown>(
      path: ConcreteApiPaths | TemplateApiPaths,
      value: TResponse,
      query?: Record<string, unknown>
    ): Promise<void> => {
      const hasQuery = query !== undefined && Object.keys(query).length > 0
      const key = hasQuery ? [path, query] : [path]
      // `false` (third arg) tells SWR: overwrite the cached value and skip
      // revalidation. Critical for optimistic overlays — we want the UI to
      // see the value immediately without racing with a GET.
      await mutate(key, value, false)
    },
    [mutate]
  )
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
 *
 * @example
 * // Template path: list messages of a specific topic
 * const { items } = useInfiniteQuery('/topics/:topicId/messages', {
 *   params: { topicId }
 * })
 */
export function useInfiniteQuery<TPath extends ApiPath>(
  path: TPath,
  options?: ParamsOption<TPath, 'GET'> & {
    /** Additional query parameters (cursor/limit are managed internally) */
    query?: Omit<QueryParamsForPath<TPath, 'GET'>, 'cursor' | 'limit'>
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

  // Resolve template once per render; key dependencies include the resolved
  // value so identity changes propagate to SWR cache keys.
  const resolvedPath = resolveTemplate(path, options?.params as Record<string, string | number> | undefined)

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

      return [resolvedPath, paginationQuery] as [string, typeof paginationQuery]
    },
    [resolvedPath, options?.query, limit, enabled]
  )

  const infiniteFetcher = (key: [string, Record<string, unknown>]) => {
    return getFetcher(key as unknown as [ConcreteApiPaths, QueryParamsForPath<ConcreteApiPaths, 'GET'>?]) as Promise<
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
    void setSize((s) => s + 1)
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
 *
 * @example
 * // Template path: paginated API keys of a specific provider
 * const { items } = usePaginatedQuery('/providers/:providerId/api-keys', {
 *   params: { providerId },
 *   limit: 20
 * })
 */
export function usePaginatedQuery<TPath extends ApiPath>(
  path: TPath,
  options?: ParamsOption<TPath, 'GET'> & {
    /** Additional query parameters (page/limit are managed internally) */
    query?: Omit<QueryParamsForPath<TPath, 'GET'>, 'page' | 'limit'>
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

  // Pass params through to useQuery so the template resolves to the same
  // concrete path (and therefore the same cache key) as a direct useQuery call.
  // Cast via `unknown` because the discriminated union between
  // "template path (params required)" and "concrete path (params forbidden)"
  // cannot be expressed once TPath itself is generic.
  const { data, isLoading, isRefreshing, error, refetch } = useQuery(path, {
    params: options?.params,
    query: queryWithPagination as QueryParamsForPath<TPath, 'GET'>,
    enabled: options?.enabled,
    swrOptions: options?.swrOptions
  } as unknown as ParamsOption<TPath, 'GET'> & {
    query?: QueryParamsForPath<TPath, 'GET'>
    enabled?: boolean
    swrOptions?: SWRConfiguration
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
      query?: QueryParamsForPath<TPath, TMethod>
    }
  ): Promise<ResponseForPath<TPath, TMethod>> => {
    // TS can't narrow generic TMethod in switch branches, so per-branch type assertions are needed
    const query = options?.query
    switch (method) {
      case 'GET':
        return dataApiService.get(path, {
          query: query as QueryParamsForPath<TPath, 'GET'>
        }) as Promise<ResponseForPath<TPath, TMethod>>
      case 'POST':
        return dataApiService.post(path, {
          body: options?.body as BodyForPath<TPath, 'POST'>,
          query: query as QueryParamsForPath<TPath, 'POST'>
        }) as Promise<ResponseForPath<TPath, TMethod>>
      case 'PUT':
        return dataApiService.put(path, {
          body: (options?.body || {}) as BodyForPath<TPath, 'PUT'>,
          query: query as QueryParamsForPath<TPath, 'PUT'>
        }) as Promise<ResponseForPath<TPath, TMethod>>
      case 'DELETE':
        return dataApiService.delete(path, {
          query: query as QueryParamsForPath<TPath, 'DELETE'>
        }) as Promise<ResponseForPath<TPath, TMethod>>
      case 'PATCH':
        return dataApiService.patch(path, {
          body: options?.body as BodyForPath<TPath, 'PATCH'>,
          query: query as QueryParamsForPath<TPath, 'PATCH'>
        }) as Promise<ResponseForPath<TPath, TMethod>>
      default:
        throw new Error(`Unsupported method: ${method}`)
    }
  }
}

/**
 * Build SWR cache key from resolved path and optional query parameters.
 *
 * Path must already be template-resolved (via {@link resolveTemplate}) so that
 * a `useQuery('/providers/:id', { params: { id: 'abc' } })` call and a caller
 * passing `'/providers/abc'` directly produce byte-for-byte identical keys.
 *
 * @internal
 * @param path - Resolved (concrete) API endpoint path
 * @param query - Optional query parameters
 * @returns Tuple of [path] or [path, query] for SWR cache key
 */
function buildSWRKey<TQuery extends Record<string, any>>(path: string, query?: TQuery): [string] | [string, TQuery] {
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
function getFetcher<TPath extends ConcreteApiPaths>([path, query]: [TPath, QueryParamsForPath<TPath, 'GET'>?]): Promise<
  ResponseForPath<TPath, 'GET'>
> {
  const apiFetcher = createApiFetcher<TPath, 'GET'>('GET')
  return apiFetcher(path, { query })
}

/**
 * Internal utilities exposed for unit testing only.
 *
 * @internal
 */
export const __testing = {
  get createKeyMatcher() {
    return createKeyMatcher
  },
  get createMultiKeyMatcher() {
    return createMultiKeyMatcher
  },
  get resolveTemplate() {
    return resolveTemplate
  },
  get buildSWRKey() {
    return buildSWRKey
  }
}

/**
 * Validate a refresh pattern in dev mode.
 *
 * Enforces:
 * - Patterns ending with `*` must end with `/*` (complete path segment prefix)
 * - Prefix must be at least 2 characters after the leading slash (no bare `/*` or `/x*`)
 *
 * @internal
 * @throws Error in development mode if pattern is invalid; silent in production
 */
function assertValidPattern(pattern: string): void {
  if (!isDev) return
  if (pattern.endsWith('*') && !pattern.endsWith('/*')) {
    const msg = `Invalid refresh pattern "${pattern}": wildcard must be a full path segment (use "/foo/*" not "/foo*")`
    logger.error(msg)
    throw new Error(msg)
  }
  if (pattern === '/*' || pattern === '*') {
    const msg = `Invalid refresh pattern "${pattern}": bare wildcard would invalidate unrelated caches`
    logger.error(msg)
    throw new Error(msg)
  }
}

/**
 * Create a filter function that matches SWR cache keys by path.
 *
 * Matches cache keys in the form [path] or [path, query].
 *
 * Pattern semantics:
 * - `"/providers"` → exact match only `["/providers"]`
 * - `"/providers/*"` → prefix match all `["/providers/...", ...]`; preserves trailing `/`
 *   to avoid false positives on sibling resources like `/providers-archived`
 *
 * @internal
 * @param pattern - Path pattern; trailing `/*` enables prefix matching
 * @returns Filter function for use with SWR's mutate
 */
function createKeyMatcher(pattern: string): (key: unknown) => boolean {
  assertValidPattern(pattern)
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1) // keep trailing '/'
    return (key) => Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith(prefix)
  }
  return (key) => Array.isArray(key) && key[0] === pattern
}

/**
 * Create a filter function that matches multiple paths.
 *
 * Supports a mix of exact and prefix (`/*`) patterns. See {@link createKeyMatcher}
 * for pattern semantics.
 *
 * @internal
 * @param patterns - Array of API paths; each may end with `/*` for prefix matching
 * @returns Filter function for use with SWR's mutate
 */
function createMultiKeyMatcher(patterns: string[]): (key: unknown) => boolean {
  patterns.forEach(assertValidPattern)
  const exact = patterns.filter((p) => !p.endsWith('/*'))
  const prefixes = patterns.filter((p) => p.endsWith('/*')).map((p) => p.slice(0, -1))
  return (key) => {
    if (!Array.isArray(key) || typeof key[0] !== 'string') return false
    const k = key[0]
    return exact.includes(k) || prefixes.some((prefix) => k.startsWith(prefix))
  }
}

/**
 * Replace Express-style `:name` and greedy `:name*` placeholders in a path
 * template with values from `params`.
 *
 * This is the single canonical path-replacement point for all data hooks — both
 * `useQuery`/`useMutation` (via `params` option) and internal key building go
 * through here. This guarantees a template path + params and a pre-resolved
 * path (e.g., `providerPath(id)`) produce byte-for-byte identical cache keys.
 *
 * Greedy params (`:name*`) consume the rest of the path segment, allowing IDs
 * that themselves contain `/` (e.g., `/models/:uniqueModelId*` where the id is
 * `openai:gpt-4/variant`).
 *
 * @internal
 * @throws Error if a placeholder has no corresponding value in `params`
 */
function resolveTemplate(path: string, params?: Record<string, string | number>): string {
  if (!params || !path.includes(':')) return path
  return path.replace(/:([a-zA-Z][a-zA-Z0-9]*)\*?/g, (_match, key) => {
    const value = params[key]
    if (value === undefined || value === null) {
      throw new Error(`Missing param "${key}" for path "${path}"`)
    }
    return String(value)
  })
}
