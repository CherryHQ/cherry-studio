import { useLayoutEffect, useRef } from 'react'
import { type Key, type Middleware, unstable_serialize, useSWRConfig } from 'swr'
import {
  type SWRInfiniteConfiguration,
  type SWRInfiniteKeyLoader,
  unstable_serialize as serializeInfiniteKey
} from 'swr/infinite'

import type { CursorPaginationResponse } from '@shared/data/api/types'

import { InfiniteQueryCacheManager, type InfiniteQueryRetentionOptions } from '../InfiniteQueryCacheManager'

/**
 * Creates bounded retention for one infinite-query consumer group. Call at module scope: each call owns a manager and
 * retention budget, so calling during render silently disables eviction.
 */
export function createInfiniteQueryRetentionMiddleware(options: InfiniteQueryRetentionOptions): Middleware {
  const manager = new InfiniteQueryCacheManager(options)

  return (useSWRNext) => {
    return function useInfiniteQueryRetention(key, fetcher, config) {
      const { cache } = useSWRConfig()
      const getKey = typeof key === 'function' ? (key as SWRInfiniteKeyLoader) : undefined
      const getKeyRef = useRef(getKey)
      getKeyRef.current = getKey
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
              const finishRequest = manager.beginRequest(cache, infiniteKey, unstable_serialize(args[0] as Key))
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
        return manager.acquire(cache, infiniteKey)
      }, [cache, enabled, infiniteKey])

      useLayoutEffect(() => {
        const currentGetKey = getKeyRef.current
        if (!enabled || !currentGetKey || !pages?.length) return

        const pageKeys: string[] = []
        let previousPage: CursorPaginationResponse<unknown> | null = null
        for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
          const pageKey = currentGetKey(pageIndex, isParallel ? null : previousPage)
          if (!pageKey) break

          const serializedPageKey = unstable_serialize(pageKey)
          if (cache.get(serializedPageKey) === undefined) return

          pageKeys.push(serializedPageKey)
          previousPage = pages[pageIndex]
        }

        if (pageKeys.length === pages.length) {
          manager.syncPages(cache, infiniteKey, pageKeys)
        }
      }, [cache, enabled, infiniteKey, isParallel, pages])

      return result
    }
  }
}
