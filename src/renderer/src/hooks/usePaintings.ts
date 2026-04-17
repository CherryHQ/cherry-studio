import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { ListPaintingsQueryParams } from '@shared/data/api/schemas/paintings'
import type { PaintingMode } from '@shared/data/types/painting'
import { debounce } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { recordsToPaintingDataList } from '../pages/paintings/model/mappers/recordToPaintingData'
import { isPaintingLoading } from '../pages/paintings/model/runtime/paintingRuntimeStore'
import {
  createPaintingRecord,
  deletePaintingRecord,
  reorderPaintingRecords,
  updatePaintingRecord
} from '../pages/paintings/model/services/paintingCollectionService'
import type { PaintingData } from '../pages/paintings/model/types/paintingData'

const PATCH_DEBOUNCE_MS = 300
const logger = loggerService.withContext('hooks/usePaintings')

export interface PaintingFilter extends ListPaintingsQueryParams {
  providerId: string
  mode?: PaintingMode
}

export interface UsePaintingsResult {
  items: PaintingData[]
  isLoading: boolean
  isReady: boolean
  createPainting: (painting: PaintingData, createMode?: PaintingMode) => PaintingData
  deletePainting: (painting: PaintingData) => Promise<void>
  updatePainting: (painting: PaintingData) => void
  reorderPaintings: (paintings: PaintingData[]) => void
}

// ─── Debounced Patch Queue ────────────────────────────────────────────

type DebouncedPatch = ReturnType<typeof debounce<(painting: PaintingData) => void>>

function usePatchQueue() {
  const ref = useRef(new Map<string, DebouncedPatch>())

  useEffect(() => {
    const debouncers = ref.current
    return () => {
      for (const d of debouncers.values()) d.cancel()
      debouncers.clear()
    }
  }, [])

  const schedule = useCallback((painting: PaintingData) => {
    const debouncers = ref.current
    let d = debouncers.get(painting.id)
    if (!d) {
      d = debounce((latest: PaintingData) => {
        void updatePaintingRecord(latest).catch((error) =>
          logger.error('Failed to persist painting update', error as Error)
        )
      }, PATCH_DEBOUNCE_MS)
      debouncers.set(painting.id, d)
    }
    d(painting)
  }, [])

  const cancel = useCallback((paintingId: string) => {
    const d = ref.current.get(paintingId)
    if (d) {
      d.cancel()
      ref.current.delete(paintingId)
    }
  }, [])

  return { schedule, cancel }
}

// ─── Main Hook ────────────────────────────────────────────────────────

export function usePaintings(filter: PaintingFilter): UsePaintingsResult {
  const { data, isLoading, refetch } = useQuery('/paintings', {
    query: filter
  })

  const [items, setItems] = useState<PaintingData[]>([])
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsReady(false)

    void recordsToPaintingDataList(data?.items ?? []).then((hydrated) => {
      if (!cancelled) {
        setItems(hydrated)
        setIsReady(true)
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

    const timer = setInterval(() => {
      refetch()
    }, 2000)

    return () => {
      clearInterval(timer)
    }
  }, [items, refetch])

  const patchQueue = usePatchQueue()

  const createPainting = useCallback(
    (painting: PaintingData, createMode?: PaintingMode) => {
      setItems((current) => [painting, ...current.filter((p) => p.id !== painting.id)])

      void createPaintingRecord(painting, {
        providerId: filter.providerId,
        mode: createMode ?? filter.mode ?? 'generate'
      }).catch((error) => logger.error('Failed to create painting', error as Error))

      return painting
    },
    [filter.mode, filter.providerId]
  )

  const deletePainting = useCallback(
    async (painting: PaintingData) => {
      void FileManager.deleteFiles(painting.files ?? [])

      let snapshot: PaintingData[] = []
      setItems((current) => {
        snapshot = current
        return current.filter((p) => p.id !== painting.id)
      })

      patchQueue.cancel(painting.id)

      try {
        await deletePaintingRecord(painting.id)
      } catch (error) {
        logger.error('Failed to delete painting', error as Error)
        setItems(snapshot)
      }
    },
    [patchQueue]
  )

  const updatePainting = useCallback(
    (painting: PaintingData) => {
      setItems((current) => current.map((p) => (p.id === painting.id ? painting : p)))
      patchQueue.schedule(painting)
    },
    [patchQueue]
  )

  const reorderPaintings = useCallback((paintings: PaintingData[]) => {
    let previousOrder: PaintingData[] = []
    setItems((current) => {
      previousOrder = current
      return paintings
    })

    void reorderPaintingRecords(paintings.map((p) => p.id)).catch((error) => {
      logger.error('Failed to reorder paintings', error as Error)
      setItems(previousOrder)
    })
  }, [])

  return useMemo(
    () => ({ items, isLoading, isReady, createPainting, deletePainting, updatePainting, reorderPaintings }),
    [items, isLoading, isReady, createPainting, deletePainting, updatePainting, reorderPaintings]
  )
}
