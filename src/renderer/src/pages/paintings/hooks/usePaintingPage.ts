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
  generating: boolean | undefined
  setGenerating: (v: boolean) => void
  abortController: AbortController | null
  setAbortController: (c: AbortController | null) => void
  provider: Provider

  fallbackUrls: string[]
  setFallbackUrls: (urls: string[]) => void
  patchPainting: (updates: Partial<T>) => void
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
  const [selectedPaintingId, setSelectedPaintingId] = useState<string>()
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [fallbackUrls, setFallbackUrls] = useState<string[]>([])
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [generating, setGenerating] = useCache('chat.generating')
  const [isTranslating, setIsTranslating] = useState(false)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)

  const providers = useAllProviders()
  const [autoTranslateWithSpace] = usePreference('chat.input.translate.auto_translate_with_space')

  const provider = providers.find((p) => p.id === providerId)!
  const selectedPainting = useMemo(
    () => (selectedPaintingId ? paintings.find((item) => item.id === selectedPaintingId) : undefined),
    [paintings, selectedPaintingId]
  )
  const painting = selectedPainting ?? paintings[0] ?? fallbackPainting

  const patchPainting = useCallback(
    (updates: Partial<T>) => {
      const updatedPainting = { ...painting, ...updates }
      if (paintings.some((p) => p.id === painting.id)) {
        updatePainting(updatedPainting)
      } else {
        createPainting(updatedPainting)
        setSelectedPaintingId(updatedPainting.id)
      }
    },
    [painting, paintings, updatePainting, createPainting]
  )

  const onSelectPainting = useCallback(
    (p: T) => {
      if (generating) return
      setSelectedPaintingId(p.id)
      setCurrentImageIndex(0)
      setFallbackUrls([])
    },
    [generating]
  )

  const onDeletePainting = useCallback(
    (paintingToDelete: T) => {
      const remaining = paintings.filter((item) => item.id !== paintingToDelete.id)

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
    [painting, paintings, deletePainting]
  )

  const handleAddPainting = useCallback(() => {
    const newPainting = getDefaultPainting()
    const added = createPainting(newPainting) as T
    setSelectedPaintingId(added.id)
    return added
  }, [createPainting, getDefaultPainting])

  const setPainting = useCallback(
    (nextPainting: T) => {
      setSelectedPaintingId(nextPainting.id)

      if (paintings.some((item) => item.id === nextPainting.id)) {
        updatePainting(nextPainting)
      }
    },
    [paintings, updatePainting]
  )

  const onCancel = useCallback(() => {
    abortController?.abort()
  }, [abortController])

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
    setSelectedPaintingId(undefined)
    setCurrentImageIndex(0)
    setFallbackUrls([])
  }, [providerId, mode])

  useEffect(() => {
    if (!isReady) return
    if (paintings.length === 0) return

    setSelectedPaintingId((current) =>
      current && paintings.some((p) => p.id === current) ? current : paintings[0]?.id
    )
  }, [isReady, paintings])

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
    generating: generating as boolean | undefined,
    setGenerating,
    abortController,
    setAbortController,
    provider,

    fallbackUrls,
    setFallbackUrls,
    patchPainting,
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
