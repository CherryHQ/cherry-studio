import { dataApiService } from '@data/DataApiService'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { PaintingCanvas } from '@renderer/types'
import type { ListPaintingsQueryParams } from '@shared/data/api/schemas/paintings'
import type { PaintingMode } from '@shared/data/types/painting'
import { debounce } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isPaintingLoading } from '../pages/paintings/utils/paintingRuntime'
import { toCanvases, toCreateDto, toUpdateDto } from './paintingCanvas'

const PATCH_DEBOUNCE_MS = 300
const logger = loggerService.withContext('hooks/usePaintings')

export interface PaintingFilter extends ListPaintingsQueryParams {
  providerId: string
  mode?: PaintingMode
}

export interface UsePaintingsResult {
  items: PaintingCanvas[]
  isLoading: boolean
  isReady: boolean
  createPainting: (painting: PaintingCanvas, createMode?: PaintingMode) => PaintingCanvas
  deletePainting: (painting: PaintingCanvas) => Promise<void>
  updatePainting: (painting: PaintingCanvas) => void
  reorderPaintings: (paintings: PaintingCanvas[]) => void
}

// ─── Debounced Patch Queue ────────────────────────────────────────────

type DebouncedPatch = ReturnType<typeof debounce<(painting: PaintingCanvas) => void>>

function usePatchQueue() {
  const ref = useRef(new Map<string, DebouncedPatch>())

  useEffect(() => {
    const debouncers = ref.current
    return () => {
      for (const d of debouncers.values()) d.cancel()
      debouncers.clear()
    }
  }, [])

  const schedule = useCallback((painting: PaintingCanvas) => {
    const debouncers = ref.current
    let d = debouncers.get(painting.id)
    if (!d) {
      d = debounce((latest: PaintingCanvas) => {
        void dataApiService
          .patch(`/paintings/${latest.id}` as '/paintings/:id', { body: toUpdateDto(latest) })
          .catch((error) => logger.error('Failed to persist painting update', error as Error))
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

  const [items, setItems] = useState<PaintingCanvas[]>([])
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsReady(false)

    void toCanvases(data?.items ?? []).then((hydrated) => {
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
    (painting: PaintingCanvas, createMode?: PaintingMode) => {
      setItems((current) => [painting, ...current.filter((p) => p.id !== painting.id)])

      const dto = toCreateDto({
        ...painting,
        providerId: filter.providerId,
        mode: createMode ?? filter.mode ?? 'generate'
      })

      void dataApiService
        .post('/paintings', { body: dto })
        .catch((error) => logger.error('Failed to create painting', error as Error))

      return painting
    },
    [filter.mode, filter.providerId]
  )

  const deletePainting = useCallback(
    async (painting: PaintingCanvas) => {
      void FileManager.deleteFiles(painting.files ?? [])

      let snapshot: PaintingCanvas[] = []
      setItems((current) => {
        snapshot = current
        return current.filter((p) => p.id !== painting.id)
      })

      patchQueue.cancel(painting.id)

      try {
        await dataApiService.delete(`/paintings/${painting.id}` as '/paintings/:id')
      } catch (error) {
        logger.error('Failed to delete painting', error as Error)
        setItems(snapshot)
      }
    },
    [patchQueue]
  )

  const updatePainting = useCallback(
    (painting: PaintingCanvas) => {
      setItems((current) => current.map((p) => (p.id === painting.id ? painting : p)))
      patchQueue.schedule(painting)
    },
    [patchQueue]
  )

  const reorderPaintings = useCallback((paintings: PaintingCanvas[]) => {
    let previousOrder: PaintingCanvas[] = []
    setItems((current) => {
      previousOrder = current
      return paintings
    })

    void dataApiService
      .post('/paintings/reorder', { body: { orderedIds: paintings.map((p) => p.id) } })
      .catch((error) => {
        logger.error('Failed to reorder paintings', error as Error)
        setItems(previousOrder)
      })
  }, [])

  return useMemo(
    () => ({ items, isLoading, isReady, createPainting, deletePainting, updatePainting, reorderPaintings }),
    [items, isLoading, isReady, createPainting, deletePainting, updatePainting, reorderPaintings]
  )
}
