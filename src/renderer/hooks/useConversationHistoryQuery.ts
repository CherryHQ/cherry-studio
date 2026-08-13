import { type ParamsOption, useInfiniteQuery, type UseInfiniteQueryResult } from '@data/hooks/useDataApi'
import { infiniteQueryCacheManager } from '@data/InfiniteQueryCacheManager'
import type { QueryParamsForPath, ResponseForPath } from '@shared/data/api/paths'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import { useLayoutEffect } from 'react'
import { type Key, type Middleware, unstable_serialize, useSWRConfig } from 'swr'
import {
  type SWRInfiniteConfiguration,
  type SWRInfiniteKeyLoader,
  unstable_serialize as serializeInfiniteKey
} from 'swr/infinite'

type ConversationHistoryPath = '/topics/:topicId/messages' | '/agent-sessions/:sessionId/messages'

type ConversationHistoryQueryOptions<TPath extends ConversationHistoryPath> = ParamsOption<TPath, 'GET'> & {
  query?: Omit<QueryParamsForPath<TPath, 'GET'>, 'cursor' | 'limit'>
  limit?: number
  enabled?: boolean
  swrOptions?: SWRInfiniteConfiguration
}

type UseConversationInfiniteQuery = <TPath extends ConversationHistoryPath>(
  path: TPath,
  options?: ConversationHistoryQueryOptions<TPath>
) => UseInfiniteQueryResult<ResponseForPath<TPath, 'GET'>>

// Both members of the closed path union are cursor endpoints; TypeScript cannot reduce that generic condition here.
const useConversationInfiniteQuery = useInfiniteQuery as UseConversationInfiniteQuery

const conversationHistoryRetentionMiddleware: Middleware = (useSWRNext) => {
  return function useConversationHistoryRetention(key, fetcher, config) {
    const { cache } = useSWRConfig()
    const getKey = typeof key === 'function' ? (key as SWRInfiniteKeyLoader) : undefined
    let enabled = false
    let infiniteKey = ''

    if (getKey) {
      try {
        enabled = Boolean(getKey(0, null))
        if (enabled) infiniteKey = serializeInfiniteKey(getKey)
      } catch {
        enabled = false
      }
    }

    const managedFetcher =
      enabled && fetcher
        ? (...args: unknown[]) => {
            const finishRequest = infiniteQueryCacheManager.beginRequest(
              cache,
              infiniteKey,
              unstable_serialize(args[0] as Key)
            )
            try {
              return Promise.resolve(fetcher(...args)).then(
                (result) => {
                  finishRequest()
                  return result
                },
                (error) => {
                  finishRequest(false)
                  throw error
                }
              )
            } catch (error) {
              finishRequest(false)
              throw error
            }
          }
        : fetcher
    const result = useSWRNext(key, managedFetcher, config)
    const pages = result.data as CursorPaginationResponse<unknown>[] | undefined
    const isParallel = (config as SWRInfiniteConfiguration).parallel === true

    useLayoutEffect(() => {
      if (!enabled) return
      return infiniteQueryCacheManager.acquire(cache, infiniteKey)
    }, [cache, enabled, infiniteKey])

    useLayoutEffect(() => {
      if (!enabled || !getKey || !pages?.length) return

      const pageKeys: string[] = []
      let previousPage: CursorPaginationResponse<unknown> | null = null
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const pageKey = getKey(pageIndex, isParallel ? null : previousPage)
        if (!pageKey) break

        const serializedPageKey = unstable_serialize(pageKey)
        if (cache.get(serializedPageKey) === undefined) return

        pageKeys.push(serializedPageKey)
        previousPage = pages[pageIndex]
      }

      if (pageKeys.length === pages.length) {
        infiniteQueryCacheManager.syncPages(cache, infiniteKey, pageKeys)
      }
    }, [cache, enabled, getKey, infiniteKey, isParallel, pages])

    return result
  }
}

export function useConversationHistoryQuery<TPath extends ConversationHistoryPath>(
  path: TPath,
  options?: ConversationHistoryQueryOptions<TPath>
): UseInfiniteQueryResult<ResponseForPath<TPath, 'GET'>> {
  const managedOptions = {
    ...options,
    swrOptions: {
      ...options?.swrOptions,
      use: [conversationHistoryRetentionMiddleware, ...(options?.swrOptions?.use ?? [])]
    }
  } as ConversationHistoryQueryOptions<TPath>

  return useConversationInfiniteQuery(path, managedOptions)
}
