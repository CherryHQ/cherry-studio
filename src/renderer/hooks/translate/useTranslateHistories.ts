import { usePaginatedQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { TRANSLATE_HISTORY_DEFAULT_LIMIT } from '@shared/data/api/schemas/translate'
import type { TranslateHistory } from '@shared/data/types/translate'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const [loadedItems, setLoadedItems] = useState<TranslateHistory[]>([])

  const {
    items,
    total,
    page,
    error,
    isLoading,
    isRefreshing,
    hasNext,
    nextPage,
    refresh: pageRefresh,
    reset
  } = usePaginatedQuery('/translate/histories', {
    query: { search: searchKey, star: starKey },
    limit: pageSize,
    swrOptions: { keepPreviousData: false }
  })

  const resetRef = useRef(reset)
  resetRef.current = reset

  useEffect(() => {
    setLoadedItems([])
    resetRef.current()
  }, [pageSize, searchKey, starKey])

  useEffect(() => {
    setLoadedItems((prev) => {
      if (page <= 1) return items

      const itemIds = new Set(items.map((item) => item.id))
      return [...prev.filter((item) => !itemIds.has(item.id)), ...items]
    })
  }, [items, page])

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

  const histories = useMemo(() => loadedItems, [loadedItems])
  const hasMore = hasNext
  const isLoadingMore = isRefreshing && page > 1

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      nextPage()
    }
  }, [isLoadingMore, hasMore, nextPage])

  const reload = useCallback(async () => {
    setLoadedItems([])
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
