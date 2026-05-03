import { useCache } from '@data/hooks/useCache'
import type { PaintingMode } from '@shared/data/types/painting'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getPaintingSelectionCacheKey } from '../../model/runtime/paintingRuntimeStore'
import type { PaintingData } from '../../model/types/paintingData'

interface UsePaintingSelectionOptions<T extends PaintingData> {
  providerId: string
  mode?: PaintingMode
  paintings: T[]
  isReady: boolean
  createDefaultPaintingData: () => T
}

export function usePaintingSelection<T extends PaintingData>({
  providerId,
  mode,
  paintings,
  isReady,
  createDefaultPaintingData
}: UsePaintingSelectionOptions<T>) {
  const fallbackPainting = useMemo(() => createDefaultPaintingData(), [createDefaultPaintingData])
  const [draftPainting, setDraftPainting] = useState(fallbackPainting)
  const selectionScope = useMemo(() => `${providerId}_${mode ?? 'default'}`, [providerId, mode])
  const [cachedSelectedPaintingId, setCachedSelectedPaintingId] = useCache(
    getPaintingSelectionCacheKey(selectionScope),
    null
  )
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const selectedPaintingId = cachedSelectedPaintingId ?? undefined
  const setSelectedPaintingId = useCallback(
    (id: string | undefined) => {
      setCachedSelectedPaintingId(id ?? null)
    },
    [setCachedSelectedPaintingId]
  )

  const selectedPainting = useMemo(
    () => (selectedPaintingId ? paintings.find((item) => item.id === selectedPaintingId) : undefined),
    [paintings, selectedPaintingId]
  )
  const painting = selectedPainting ?? paintings[0] ?? draftPainting

  const patchDraftPainting = useCallback((updates: Partial<T>) => {
    setDraftPainting((current) => ({ ...current, ...updates }) as T)
  }, [])

  const onSelectPainting = useCallback(
    (nextPainting: T) => {
      setSelectedPaintingId(nextPainting.id)
      setCurrentImageIndex(0)
    },
    [setSelectedPaintingId]
  )

  const prevImage = useCallback(() => {
    setCurrentImageIndex((prev) => (prev - 1 + (painting.files?.length || 1)) % (painting.files?.length || 1))
  }, [painting.files?.length])

  const nextImage = useCallback(() => {
    setCurrentImageIndex((prev) => (prev + 1) % (painting.files?.length || 1))
  }, [painting.files?.length])

  useEffect(() => {
    setCurrentImageIndex(0)
    setDraftPainting(fallbackPainting)
  }, [fallbackPainting, mode, providerId])

  useEffect(() => {
    if (!isReady) return
    if (paintings.length === 0) {
      setSelectedPaintingId(undefined)
      return
    }

    if (!selectedPaintingId || !paintings.some((item) => item.id === selectedPaintingId)) {
      setSelectedPaintingId(paintings[0]?.id)
    }
  }, [isReady, paintings, selectedPaintingId, setSelectedPaintingId])

  return {
    painting,
    selectedPaintingId,
    setSelectedPaintingId,
    currentImageIndex,
    setCurrentImageIndex,
    onSelectPainting,
    patchDraftPainting,
    prevImage,
    nextImage
  }
}
