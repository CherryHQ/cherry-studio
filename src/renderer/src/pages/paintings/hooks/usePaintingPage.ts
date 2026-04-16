import { useCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { LanguagesEnum } from '@renderer/config/translate'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { translateText } from '@renderer/services/TranslateService'
import type { PaintingCanvas } from '@renderer/types'
import type { Provider } from '@renderer/types/provider'
import type { PaintingMode } from '@shared/data/types/painting'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  abortPaintingGeneration,
  clearPaintingAbortController,
  clearPaintingRuntimeState,
  getPaintingSelectionCacheKey,
  setPaintingFallbackUrls,
  setPaintingLoading,
  usePaintingRuntime
} from '../utils/paintingRuntime'

export interface UsePaintingPageOptions<T extends PaintingCanvas = PaintingCanvas> {
  providerId: string
  mode?: PaintingMode
  getDefaultPainting: () => T
  onProviderChange: (id: string) => void
}

export interface UsePaintingPageReturn<T extends PaintingCanvas = PaintingCanvas> {
  painting: T
  setPainting: (p: T) => void
  paintings: T[]
  selectedPaintingId: string | undefined
  setSelectedPaintingId: (id: string | undefined) => void
  currentImageIndex: number
  isLoading: boolean
  setIsLoading: (v: boolean) => void
  isTranslating: boolean
  provider: Provider

  fallbackUrls: string[]
  setFallbackUrls: (urls: string[]) => void
  setFallbackUrlsForPainting: (paintingId: string, urls: string[]) => void
  setIsLoadingForPainting: (paintingId: string, value: boolean) => void
  patchPainting: (updates: Partial<T>) => void
  patchPaintingById: (paintingId: string, updates: Partial<T>) => void
  onSelectPainting: (p: T) => void
  onDeletePainting: (p: T) => void
  handleAddPainting: () => T
  onCancel: () => void
  prevImage: () => void
  nextImage: () => void
  handleProviderChange: (id: string) => void
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  reorder: (paintings: T[]) => void

  translate: () => Promise<void>
}

export function usePaintingPage<T extends PaintingCanvas = PaintingCanvas>({
  providerId,
  mode,
  getDefaultPainting,
  onProviderChange
}: UsePaintingPageOptions<T>): UsePaintingPageReturn<T> {
  const { items, isReady, createPainting, deletePainting, updatePainting, reorderPaintings } = usePaintings({
    providerId,
    mode
  })
  const paintings = items as T[]

  const fallbackPainting = useMemo(() => getDefaultPainting(), [getDefaultPainting])
  const selectionScope = useMemo(() => `${providerId}_${mode ?? 'default'}`, [providerId, mode])
  const [cachedSelectedPaintingId, setCachedSelectedPaintingId] = useCache(
    getPaintingSelectionCacheKey(selectionScope),
    null
  )
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)

  const providers = useAllProviders()
  const [autoTranslateWithSpace] = usePreference('chat.input.translate.auto_translate_with_space')

  const provider = providers.find((p) => p.id === providerId)!
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
  const painting = selectedPainting ?? paintings[0] ?? fallbackPainting
  const [paintingRuntime] = usePaintingRuntime(painting.id)
  const isLoading = paintingRuntime.isLoading
  const fallbackUrls = paintingRuntime.fallbackUrls

  const setIsLoading = useCallback(
    (value: boolean) => {
      setPaintingLoading(painting.id, value)
    },
    [painting.id]
  )

  const setIsLoadingForPainting = useCallback((paintingId: string, value: boolean) => {
    setPaintingLoading(paintingId, value)
  }, [])

  const setFallbackUrls = useCallback(
    (urls: string[]) => {
      setPaintingFallbackUrls(painting.id, urls)
    },
    [painting.id]
  )

  const setFallbackUrlsForPainting = useCallback((paintingId: string, urls: string[]) => {
    setPaintingFallbackUrls(paintingId, urls)
  }, [])

  const patchPaintingById = useCallback(
    (paintingId: string, updates: Partial<T>) => {
      const targetPainting =
        paintings.find((item) => item.id === paintingId) ??
        (painting.id === paintingId ? painting : ({ id: paintingId, files: [] } as T))
      const updatedPainting = { ...targetPainting, ...updates }

      if (paintings.some((p) => p.id === paintingId)) {
        updatePainting(updatedPainting)
      } else {
        createPainting(updatedPainting)
        setSelectedPaintingId(updatedPainting.id)
      }
    },
    [painting, paintings, updatePainting, createPainting, setSelectedPaintingId]
  )

  const patchPainting = useCallback(
    (updates: Partial<T>) => {
      patchPaintingById(painting.id, updates)
    },
    [painting.id, patchPaintingById]
  )

  const onSelectPainting = useCallback(
    (p: T) => {
      setSelectedPaintingId(p.id)
      setCurrentImageIndex(0)
    },
    [setSelectedPaintingId]
  )

  const onDeletePainting = useCallback(
    (paintingToDelete: T) => {
      const remaining = paintings.filter((item) => item.id !== paintingToDelete.id)

      abortPaintingGeneration(paintingToDelete.id)
      clearPaintingAbortController(paintingToDelete.id)
      clearPaintingRuntimeState(paintingToDelete.id)

      if (paintingToDelete.id === painting.id) {
        const currentIndex = paintings.findIndex((p) => p.id === paintingToDelete.id)

        if (currentIndex > 0) {
          setSelectedPaintingId(paintings[currentIndex - 1]?.id)
        } else if (remaining.length > 0) {
          setSelectedPaintingId(remaining[0]?.id)
        } else {
          setSelectedPaintingId(undefined)
        }
      }

      void deletePainting(paintingToDelete)
    },
    [painting, paintings, deletePainting, setSelectedPaintingId]
  )

  const handleAddPainting = useCallback(() => {
    const newPainting = getDefaultPainting()
    const added = createPainting(newPainting) as T
    setSelectedPaintingId(added.id)
    setCurrentImageIndex(0)
    return added
  }, [createPainting, getDefaultPainting, setSelectedPaintingId])

  const setPainting = useCallback(
    (nextPainting: T) => {
      setSelectedPaintingId(nextPainting.id)

      if (paintings.some((item) => item.id === nextPainting.id)) {
        updatePainting(nextPainting)
      }
    },
    [paintings, updatePainting, setSelectedPaintingId]
  )

  const onCancel = useCallback(() => {
    abortPaintingGeneration(painting.id)
  }, [painting.id])

  const prevImage = useCallback(() => {
    setCurrentImageIndex((prev) => (prev - 1 + (painting.files?.length || 1)) % (painting.files?.length || 1))
  }, [painting.files?.length])

  const nextImage = useCallback(() => {
    setCurrentImageIndex((prev) => (prev + 1) % (painting.files?.length || 1))
  }, [painting.files?.length])

  const handleProviderChange = useCallback(
    (newProviderId: string) => {
      if (newProviderId !== providerId) {
        onProviderChange(newProviderId)
      }
    },
    [onProviderChange, providerId]
  )

  const translate = useCallback(async () => {
    if (isTranslating) return
    if (!painting.prompt) return

    try {
      setIsTranslating(true)
      const translatedText = await translateText(painting.prompt, LanguagesEnum.enUS)
      patchPainting({ prompt: translatedText } as Partial<T>)
    } finally {
      setIsTranslating(false)
    }
  }, [isTranslating, painting.prompt, patchPainting])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (autoTranslateWithSpace && event.key === ' ') {
        setSpaceClickCount((prev) => prev + 1)

        if (spaceClickTimer.current) {
          clearTimeout(spaceClickTimer.current)
        }

        spaceClickTimer.current = setTimeout(() => {
          setSpaceClickCount(0)
        }, 200)

        if (spaceClickCount === 2) {
          setSpaceClickCount(0)
          setIsTranslating(true)
          void translate()
        }
      }
    },
    [autoTranslateWithSpace, spaceClickCount, translate]
  )

  useEffect(() => {
    setCurrentImageIndex(0)
  }, [providerId, mode])

  useEffect(() => {
    if (!isReady) return
    if (paintings.length === 0) {
      setSelectedPaintingId(undefined)
      return
    }

    if (!selectedPaintingId || !paintings.some((p) => p.id === selectedPaintingId)) {
      setSelectedPaintingId(paintings[0]?.id)
    }
  }, [isReady, paintings, selectedPaintingId, setSelectedPaintingId])

  useEffect(() => {
    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [])

  return {
    painting,
    setPainting,
    paintings,
    selectedPaintingId,
    setSelectedPaintingId,
    currentImageIndex,
    isLoading,
    setIsLoading,
    isTranslating,
    provider,

    fallbackUrls,
    setFallbackUrls,
    setFallbackUrlsForPainting,
    setIsLoadingForPainting,
    patchPainting,
    patchPaintingById,
    onSelectPainting,
    onDeletePainting,
    handleAddPainting,
    onCancel,
    prevImage,
    nextImage,
    handleProviderChange,
    handleKeyDown,
    reorder: reorderPaintings as (paintings: T[]) => void,

    translate
  }
}
