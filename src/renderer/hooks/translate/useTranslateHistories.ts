import { useInfiniteFlatItems, useInfiniteQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { TRANSLATE_HISTORY_DEFAULT_LIMIT } from '@shared/data/api/schemas/translate'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('translate/useTranslateHistories')

interface UseTranslateHistoriesOptions {
  /** Full-text search on sourceText/targetText (server-side LIKE). */
  search?: string
  /** Filter for starred records only (server-side). */
  star?: boolean
  /** Items per fetched page. Defaults to {@link TRANSLATE_HISTORY_DEFAULT_LIMIT}. */
  pageSize?: number
}

export const useTranslateHistories = ({
  search,
  star,
  pageSize = TRANSLATE_HISTORY_DEFAULT_LIMIT
}: UseTranslateHistoriesOptions = {}) => {
  const searchKey = search?.trim() || undefined
  const starKey = star || undefined
  const query = useMemo(() => ({ search: searchKey, star: starKey }), [searchKey, starKey])

  const {
    pages,
    error,
    isLoading,
    isRefreshing,
    hasNext,
    loadNext,
    refresh: pageRefresh,
    reset
  } = useInfiniteQuery('/translate/histories', {
    query,
    limit: pageSize,
    swrOptions: { keepPreviousData: false }
  })
  const histories = useInfiniteFlatItems(pages)
  const total = pages[0]?.total ?? 0

  const resetRef = useRef(reset)
  resetRef.current = reset

  useEffect(() => {
    resetRef.current()
  }, [pageSize, searchKey, starKey])

  const { t } = useTranslation()
  // One-shot UX surface: mirror useLanguages — only notify the user once per
  // session on load failure so SWR retries don't spam toasts.
  const toastedRef = useRef(false)
  useEffect(() => {
    if (error && !toastedRef.current) {
      toastedRef.current = true
      logger.error('Failed to load translate histories', error)
      window.toast?.error(t('translate.history.error.load'))
    }
  }, [error, t])

  const hasMore = hasNext
  const isLoadingMore = isRefreshing && pages.length > 0

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      loadNext()
    }
  }, [isLoadingMore, hasMore, loadNext])

  const reload = useCallback(async () => {
    resetRef.current()
    await pageRefresh()
  }, [pageRefresh])

  // Loading / error / ready discriminator. Empty `items` is ambiguous on its
  // own (still loading? load failed? legitimately no records?), so callers
  // that need to render distinct UI for each state should switch on `status`
  // rather than inspect `items.length` and `error` separately.
  const status: 'loading' | 'error' | 'ready' = isLoading ? 'loading' : error !== undefined ? 'error' : 'ready'

  return {
    items: histories,
    total,
    hasMore,
    isLoading,
    isLoadingMore,
    isValidating: isRefreshing,
    error,
    loadMore,
    refresh: reload,
    status
  }
}
