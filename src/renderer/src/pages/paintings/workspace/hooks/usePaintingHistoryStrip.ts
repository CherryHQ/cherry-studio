import { useQuery } from '@data/hooks/useDataApi'
import type { PaintingMode } from '@shared/data/types/painting'
import { useEffect, useState } from 'react'

import { recordToPaintingData } from '../../model/mappers/recordToPaintingData'
import { isPaintingLoading } from '../../model/runtime/paintingRuntimeStore'
import type { PaintingData } from '../../model/types/paintingData'

const HISTORY_LIMIT = 100
const HISTORY_REFRESH_MS = 2000

export interface PaintingHistoryItem extends PaintingData {
  dbMode: PaintingMode
  createdAt: string
}

export function usePaintingHistoryStrip() {
  const { data, isLoading, refetch } = useQuery('/paintings', {
    query: {
      limit: HISTORY_LIMIT
    }
  })
  const [items, setItems] = useState<PaintingHistoryItem[]>([])

  useEffect(() => {
    let cancelled = false

    void Promise.all(
      (data?.items ?? []).map(async (record) => ({
        ...(await recordToPaintingData(record)),
        dbMode: record.mode,
        createdAt: record.createdAt
      }))
    ).then((hydrated) => {
      if (!cancelled) {
        setItems(hydrated)
      }
    })

    return () => {
      cancelled = true
    }
  }, [data])

  useEffect(() => {
    if (!items.some((item) => isPaintingLoading(item))) {
      return
    }

    const timer = window.setInterval(() => {
      refetch()
    }, HISTORY_REFRESH_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [items, refetch])

  return {
    items,
    isLoading
  }
}
