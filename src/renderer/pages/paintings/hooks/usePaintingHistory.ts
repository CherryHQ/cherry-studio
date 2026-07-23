import { useInfiniteFlatItems, useInfiniteQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { Painting } from '@shared/data/types/painting'
import { useEffect, useRef, useState } from 'react'

import { recordsToPaintingDataList } from '../model/mappers/recordToPaintingData'
import type { PaintingData } from '../model/types/paintingData'

const PAGE_SIZE = 30
const logger = loggerService.withContext('usePaintingHistory')

export type PaintingStripEntry = PaintingData

interface HydratedPaintingCacheEntry {
  fingerprint: string
  item: PaintingData
}

function getHydrationFingerprint(record: Painting): string {
  return JSON.stringify([
    record.id,
    record.providerId,
    record.modelId,
    record.prompt,
    record.createdAt,
    record.files.input,
    record.files.output
  ])
}

export function usePaintingHistory(): {
  items: PaintingStripEntry[]
  isLoading: boolean
  hasMore: boolean
  loadMore: () => void
} {
  const { pages, isLoading, isRefreshing, hasNext, loadNext } = useInfiniteQuery('/paintings', { limit: PAGE_SIZE })
  const records = useInfiniteFlatItems(pages)

  const [items, setItems] = useState<PaintingStripEntry[]>([])
  const hydratedByIdRef = useRef(new Map<string, HydratedPaintingCacheEntry>())

  useEffect(() => {
    let cancelled = false
    const recordsWithFingerprints = records.map((record) => ({
      record,
      fingerprint: getHydrationFingerprint(record)
    }))
    const previousCache = hydratedByIdRef.current
    const recordsToHydrate = recordsWithFingerprints.filter(
      ({ record, fingerprint }) => previousCache.get(record.id)?.fingerprint !== fingerprint
    )

    const hydrateHistory = async () => {
      const hydratedItems =
        recordsToHydrate.length > 0 ? await recordsToPaintingDataList(recordsToHydrate.map(({ record }) => record)) : []

      if (cancelled) return

      let hydratedIndex = 0
      const nextCache = new Map<string, HydratedPaintingCacheEntry>()
      const nextItems = recordsWithFingerprints.map(({ record, fingerprint }) => {
        const cached = previousCache.get(record.id)
        const item = cached?.fingerprint === fingerprint ? cached.item : hydratedItems[hydratedIndex++]
        nextCache.set(record.id, { fingerprint, item })
        return item
      })

      hydratedByIdRef.current = nextCache
      setItems(nextItems)
    }

    void hydrateHistory().catch((error) => {
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
