import { useLayoutEffect, useRef } from 'react'
import { type Key, type Middleware, unstable_serialize, useSWRConfig } from 'swr'
import { type SWRInfiniteKeyLoader, unstable_serialize as serializeInfiniteKey } from 'swr/infinite'

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
      const getKey: SWRInfiniteKeyLoader<unknown> | undefined = typeof key === 'function' ? key : undefined
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
          ? (pageKey: Key) => {
              const finishRequest = manager.beginRequest(cache, infiniteKey, unstable_serialize(pageKey))

              try {
                return Promise.resolve(fetcher(pageKey)).then(
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
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- This middleware wraps SWR infinite's page array; individual page values remain opaque and are passed back unchanged to its original loader.
      const pages = result.data as readonly unknown[] | undefined
      const infiniteConfig: typeof config & { parallel?: unknown } = config
      const isParallel = infiniteConfig.parallel === true

      useLayoutEffect(() => {
        if (!enabled) return

        return manager.acquire(cache, infiniteKey)
      }, [cache, enabled, infiniteKey])

      useLayoutEffect(() => {
        const currentGetKey = getKeyRef.current

        if (!enabled || !currentGetKey || !pages?.length) return

        const pageKeys: string[] = []

        for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
          const pageKey = currentGetKey(pageIndex, isParallel || pageIndex === 0 ? null : pages[pageIndex - 1])

          if (!pageKey) break

          const serializedPageKey = unstable_serialize(pageKey)

          if (cache.get(serializedPageKey) === undefined) return

          pageKeys.push(serializedPageKey)
        }

        if (pageKeys.length === pages.length) {
          manager.syncPages(cache, infiniteKey, pageKeys)
        }
      }, [cache, enabled, infiniteKey, isParallel, pages])

      return result
    }
  }
}
