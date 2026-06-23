import { useInfiniteFlatItems, useInfiniteQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { CreationKind } from '@shared/data/types/creation'
import { useEffect, useMemo, useState } from 'react'

import { recordsToPaintingDataList } from '../paintings/model/mappers/recordToPaintingData'
import type { CreationData } from './types'

const PAGE_SIZE = 30
const logger = loggerService.withContext('useCreationHistory')

export type CreationGalleryEntry = CreationData

export function useCreationHistory(kind?: CreationKind): {
  items: CreationGalleryEntry[]
  isLoading: boolean
  hasMore: boolean
  loadMore: () => void
} {
  const query = useMemo(() => (kind ? { kind } : undefined), [kind])
  const options = useMemo(() => (query ? { query, limit: PAGE_SIZE } : { limit: PAGE_SIZE }), [query])
  const { pages, isLoading, isRefreshing, hasNext, loadNext } = useInfiniteQuery('/creations', options)
  const records = useInfiniteFlatItems(pages)

  const [items, setItems] = useState<CreationGalleryEntry[]>([])

  useEffect(() => {
    let cancelled = false
    void recordsToPaintingDataList(records)
      .then((mapped) => {
        if (!cancelled) setItems(mapped)
      })
      .catch((error) => {
        logger.error('Failed to hydrate creation history', error as Error)
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
