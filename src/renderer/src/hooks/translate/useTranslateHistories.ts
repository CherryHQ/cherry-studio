import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { TRANSLATE_HISTORY_DEFAULT_LIMIT } from '@shared/data/api/schemas/translate'
import type { TranslateHistory } from '@shared/data/types/translate'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRInfinite from 'swr/infinite'

const logger = loggerService.withContext('translate/useTranslateHistories')

interface UseTranslateHistoriesOptions {
  /** Full-text search on sourceText/targetText (server-side LIKE). */
  search?: string
  /** Filter for starred records only (server-side). */
  star?: boolean
  /** Items per fetched page. Defaults to {@link TRANSLATE_HISTORY_DEFAULT_LIMIT}. */
  pageSize?: number
}

/**
 * Infinite-scroll hook for translate history, backed by `/translate/histories`.
 *
 * Wraps {@link useSWRInfinite} with offset-based pagination. The endpoint returns
 * {@link OffsetPaginationResponse}, so the standard framework {@link useInfiniteQuery}
 * (cursor-based) cannot be used directly. Mirrors the pattern used in `useSessions.ts`.
 *
 * @remarks
 * - `search` and `star` are part of the SWR key, so changing either resets the list.
 * - Mutations elsewhere (`useAddHistory`, `useDeleteHistory`, `useClearHistory`,
 *   `useUpdateHistory`) call `refresh: ['/translate/histories']`, which invalidates
 *   every page this hook holds because all keys share that path prefix.
 */
export const useTranslateHistories = ({
  search,
  star,
  pageSize = TRANSLATE_HISTORY_DEFAULT_LIMIT
}: UseTranslateHistoriesOptions = {}) => {
  const searchKey = search?.trim() || undefined
  const starKey = star || undefined

  const getKey = useCallback(
    (pageIndex: number, previousPageData: { items: TranslateHistory[] } | null) => {
      if (previousPageData && previousPageData.items.length < pageSize) return null
      return ['/translate/histories', pageIndex + 1, pageSize, searchKey, starKey] as const
    },
    [pageSize, searchKey, starKey]
  )

  const fetcher = useCallback(
    async ([path, page, limit, searchArg, starArg]: readonly [
      '/translate/histories',
      number,
      number,
      string | undefined,
      boolean | undefined
    ]) => {
      return dataApiService.get(path, {
        query: {
          page,
          limit,
          search: searchArg,
          star: starArg
        }
      })
    },
    []
  )

  const { data, error, isLoading, isValidating, mutate, size, setSize } = useSWRInfinite(getKey, fetcher)

  const { t } = useTranslation()
  // One-shot UX surface: mirror useLanguages — only notify the user once per
  // session on load failure so SWR retries don't spam toasts.
  const toastedRef = useRef(false)
  useEffect(() => {
    if (error && !toastedRef.current) {
      toastedRef.current = true
      logger.error('Failed to load translate histories', error)
      window.toast.error(t('translate.history.error.load'))
    }
  }, [error, t])

  const items = useMemo(() => data?.flatMap((p) => p.items) ?? [], [data])
  const total = data?.[0]?.total ?? 0
  const hasMore = items.length < total
  const isLoadingMore = isLoading || (size > 0 && data !== undefined && typeof data[size - 1] === 'undefined')

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      void setSize((current) => current + 1)
    }
  }, [isLoadingMore, hasMore, setSize])

  const refresh = useCallback(async () => {
    await mutate()
  }, [mutate])

  return {
    items,
    total,
    hasMore,
    isLoading,
    isLoadingMore,
    isValidating,
    error,
    loadMore,
    refresh
  }
}
