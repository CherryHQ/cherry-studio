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
  const { pages, isLoading, isRefreshing, hasNext, loadNext } = useInfiniteQuery('/paintings', { limit: PAGE_SIZE })
  const records = useInfiniteFlatItems(pages)

  const [items, setItems] = useState<PaintingStripEntry[]>([])

  useEffect(() => {
    let cancelled = false
    void recordsToPaintingDataList(records)
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
    isLoading: isLoading || isRefreshing,
    hasMore: hasNext,
    loadMore: loadNext
  }
}
