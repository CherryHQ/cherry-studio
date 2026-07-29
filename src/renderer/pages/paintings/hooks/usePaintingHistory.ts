import { useInfiniteFlatItems, useInfiniteQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useEffect, useState } from 'react'

import { recordsToPaintingDataList } from '../model/mappers/recordToPaintingData'
import type { PaintingData } from '../model/types/paintingData'

const PAGE_SIZE = 30
const logger = loggerService.withContext('usePaintingHistory')

export type PaintingStripEntry = PaintingData

export function usePaintingHistory(): {
  items: PaintingStripEntry[]
  isLoading: boolean
  hasMore: boolean
  loadMore: () => void
} {
  const {
    pages,
    isLoading: isQueryLoading,
    isRefreshing,
    hasNext,
    loadNext
  } = useInfiniteQuery('/paintings', { limit: PAGE_SIZE })
  const records = useInfiniteFlatItems(pages)

  const [hydration, setHydration] = useState<{
    records: typeof records
    items: PaintingStripEntry[]
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void recordsToPaintingDataList(records)
      .then((mapped) => {
        if (!cancelled) setHydration({ records, items: mapped })
      })
      .catch((error) => {
        if (cancelled) return
        logger.error('Failed to hydrate painting history', error as Error)
        setHydration({ records, items: [] })
      })
    return () => {
      cancelled = true
    }
  }, [records])

  const currentHydration = hydration?.records === records ? hydration : null

  return {
    items: hydration?.items ?? [],
    isLoading: isQueryLoading || isRefreshing || !currentHydration,
    hasMore: hasNext,
    loadMore: loadNext
  }
}
