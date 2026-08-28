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

type PaintingHistoryHydrationPlanEntry = {
  record: Painting
  fingerprint: string
  cached?: PaintingHistoryCacheEntry
}

function getPaintingHydrationFingerprint(record: Painting): string {
  return JSON.stringify([
    record.providerId,
    record.modelId,
    record.prompt,
    record.createdAt,
    record.files.input,
    record.files.output,
    record.fileDataFingerprint
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
    const hydrationPlan: PaintingHistoryHydrationPlanEntry[] = records.map((record) => ({
      record,
      fingerprint: getPaintingHydrationFingerprint(record),
      cached: hydrationCacheRef.current.get(record.id)
    }))
    const missingEntries = hydrationPlan.filter((entry) => entry.cached?.fingerprint !== entry.fingerprint)
    const missingHydration = missingEntries.length
      ? recordsToPaintingDataList(missingEntries.map((entry) => entry.record))
      : Promise.resolve([])

    void missingHydration
      .then((mapped) => {
        if (cancelled) return

        const freshEntries = new Map<PaintingHistoryHydrationPlanEntry, PaintingHistoryCacheEntry>()
        for (const [index, entry] of missingEntries.entries()) {
          const item = mapped[index]
          if (!item) throw new Error(`Missing hydrated painting history entry at index ${index}`)
          freshEntries.set(entry, { fingerprint: entry.fingerprint, item })
        }

        const nextCache = new Map<string, PaintingHistoryCacheEntry>()
        const items = hydrationPlan.map((entry) => {
          const cached = entry.cached?.fingerprint === entry.fingerprint ? entry.cached : undefined
          const result = freshEntries.get(entry) ?? cached
          if (!result) throw new Error(`Missing painting history cache entry for ${entry.record.id}`)
          nextCache.set(entry.record.id, result)
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
