import { useInfiniteFlatItems, useInfiniteQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { Painting } from '@shared/data/types/painting'
import { useEffect, useRef, useState } from 'react'

import { recordsToPaintingDataList } from '../model/mappers/recordToPaintingData'
import type { PaintingData } from '../model/types/paintingData'

const PAGE_SIZE = 30
const logger = loggerService.withContext('usePaintingHistory')

export type PaintingStripEntry = PaintingData

type PaintingHistoryCacheEntry = {
  fingerprint: string
  item: PaintingStripEntry
}

function getPaintingHydrationFingerprint(record: Painting, item: PaintingStripEntry): string {
  return JSON.stringify([
    record.providerId,
    record.modelId,
    record.prompt,
    record.createdAt,
    record.files.input,
    record.files.output,
    item.files,
    item.inputFiles
  ])
}

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
  const hydrationCacheRef = useRef<Map<string, PaintingHistoryCacheEntry>>(new Map())

  const [hydration, setHydration] = useState<{
    records: typeof records
    items: PaintingStripEntry[]
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void recordsToPaintingDataList(records)
      .then((mapped) => {
        if (cancelled) return

        const nextCache = new Map<string, PaintingHistoryCacheEntry>()
        const items = records.map((record, index) => {
          const item = mapped[index]
          if (!item) throw new Error(`Missing hydrated painting history entry at index ${index}`)
          const fingerprint = getPaintingHydrationFingerprint(record, item)
          const cached = hydrationCacheRef.current.get(record.id)
          const result = cached?.fingerprint === fingerprint ? cached : { fingerprint, item }
          nextCache.set(record.id, result)
          return result.item
        })

        hydrationCacheRef.current = nextCache
        setHydration({ records, items })
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
