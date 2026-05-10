import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { PaintingListResponse } from '@shared/data/api/schemas/paintings'
import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWRInfinite from 'swr/infinite'

import { recordToPaintingData } from '../model/mappers/recordToPaintingData'
import type { PaintingData } from '../model/types/paintingData'

const PAGE_SIZE = 30
const logger = loggerService.withContext('usePaintingHistory')
const EMPTY_PAGES: PaintingListResponse[] = []

export type PaintingStripEntry = PaintingData

export function usePaintingHistory(): {
  items: PaintingStripEntry[]
  isLoading: boolean
  hasMore: boolean
  loadMore: () => void
} {
  const getKey = useCallback((pageIndex: number, previousPageData: PaintingListResponse | null) => {
    if (previousPageData && previousPageData.offset + previousPageData.items.length >= previousPageData.total) {
      return null
    }

    return ['/paintings', { limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }]
  }, [])
  const { data, isLoading, isValidating, setSize } = useSWRInfinite<PaintingListResponse>(getKey, ([path, query]) =>
    dataApiService.get(path as '/paintings', { query })
  )
  const pages = data ?? EMPTY_PAGES
  const records = useMemo(() => pages.flatMap((page) => page.items), [pages])
  const total = pages[0]?.total ?? 0
  const hasMore = records.length < total
  const [items, setItems] = useState<PaintingStripEntry[]>([])
  const loadMore = useCallback(() => {
    if (!isLoading && !isValidating && hasMore) {
      void setSize((count) => count + 1)
    }
  }, [hasMore, isLoading, isValidating, setSize])

  useEffect(() => {
    let cancelled = false
    void Promise.all(records.map((record) => recordToPaintingData(record)))
      .then((mapped) => {
        if (!cancelled) setItems(mapped)
      })
      .catch((error) => {
        logger.error('Failed to hydrate painting history', error as Error)
      })
    return () => {
      cancelled = true
    }
  }, [records])

  return {
    items,
    isLoading: isLoading || isValidating,
    hasMore,
    loadMore
  }
}
