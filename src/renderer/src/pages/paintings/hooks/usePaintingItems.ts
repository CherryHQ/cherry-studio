import { usePaintings } from '@renderer/hooks/usePaintings'
import { useEffect, useState } from 'react'

import { recordToPaintingData } from '../model/mappers/recordToPaintingData'
import type { PaintingData } from '../model/types/paintingData'

export type PaintingStripEntry = PaintingData

export function usePaintingItems(): { items: PaintingStripEntry[] } {
  const { records } = usePaintings()
  const [items, setItems] = useState<PaintingStripEntry[]>([])

  useEffect(() => {
    let cancelled = false
    void Promise.all(records.map((r) => recordToPaintingData(r))).then((mapped) => {
      if (!cancelled) setItems(mapped)
    })
    return () => {
      cancelled = true
    }
  }, [records])

  return { items }
}
