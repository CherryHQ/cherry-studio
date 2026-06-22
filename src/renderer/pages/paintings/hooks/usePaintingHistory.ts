import { useInfiniteFlatItems, useInfiniteQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { CreationKind } from '@shared/data/types/creation'
import { useEffect, useState } from 'react'

import { recordsToPaintingDataList } from '../model/mappers/recordToPaintingData'
import type { PaintingData } from '../model/types/paintingData'

const PAGE_SIZE = 30
const logger = loggerService.withContext('usePaintingHistory')

export type PaintingStripEntry = PaintingData

export function usePaintingHistory(kind: CreationKind = 'image'): {
  items: PaintingStripEntry[]
  isLoading: boolean
  hasMore: boolean
  loadMore: () => void
} {
  // Image | video history, both `creation` rows (Creation page Image/Video tabs).
  const { pages, isLoading, isRefreshing, hasNext, loadNext } = useInfiniteQuery('/creations', {
    query: { kind },
    limit: PAGE_SIZE
  })
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
