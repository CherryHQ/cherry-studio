import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { Painting } from '@shared/data/types/painting'
import { useCallback, useEffect, useState } from 'react'

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
  const [offset, setOffset] = useState(0)
  const [loadedRecords, setLoadedRecords] = useState<Painting[]>([])

  const { data, isLoading, isRefreshing } = useQuery('/paintings', {
    query: { limit: PAGE_SIZE, offset }
  })

  const total = data?.total ?? 0

  useEffect(() => {
    const page = data?.items
    if (!page) return
    setLoadedRecords((prev) => {
      if (offset === 0) return page
      const pageIds = new Set(page.map((record) => record.id))
      return [...prev.filter((record) => !pageIds.has(record.id)), ...page]
    })
  }, [data, offset])

  const hasMore = loadedRecords.length < total

  const loadMore = useCallback(() => {
    if (!isLoading && !isRefreshing && hasMore) {
      setOffset((current) => current + PAGE_SIZE)
    }
  }, [hasMore, isLoading, isRefreshing])

  const [items, setItems] = useState<PaintingStripEntry[]>([])

  useEffect(() => {
    let cancelled = false
    void recordsToPaintingDataList(loadedRecords)
      .then((mapped) => {
        if (!cancelled) setItems(mapped)
      })
      .catch((error) => {
        logger.error('Failed to hydrate painting history', error as Error)
      })
    return () => {
      cancelled = true
    }
  }, [loadedRecords])

  return {
    items,
    isLoading: isLoading || isRefreshing,
    hasMore,
    loadMore
  }
}
