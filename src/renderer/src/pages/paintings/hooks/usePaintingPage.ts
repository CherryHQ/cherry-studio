import { useCache } from '@data/hooks/useCache'
import { usePaintingList } from '@data/hooks/usePaintings'
import { usePreference } from '@data/hooks/usePreference'
import { LanguagesEnum } from '@renderer/config/translate'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { translateText } from '@renderer/services/TranslateService'
import type { PaintingAction } from '@renderer/types'
import type { Provider } from '@renderer/types/provider'
import type { PaintingMode } from '@shared/data/types/painting'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UsePaintingPageOptions<T extends PaintingAction = PaintingAction> {
  providerId: string
  mode?: PaintingMode
  getDefaultPainting: () => T
  onProviderChange: (id: string) => void
}

export interface UsePaintingPageReturn<T extends PaintingAction = PaintingAction> {
  painting: T
  setPainting: (p: T) => void
  paintings: T[]
  currentImageIndex: number
  isLoading: boolean
  setIsLoading: (v: boolean) => void
  isTranslating: boolean
  generating: boolean | undefined
  setGenerating: (v: boolean) => void
  abortController: AbortController | null
  setAbortController: (c: AbortController | null) => void
  provider: Provider

  updatePaintingState: (updates: Partial<T>) => void
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

export function usePaintingPage<T extends PaintingAction = PaintingAction>({
  providerId,
  mode,
  getDefaultPainting,
  onProviderChange
}: UsePaintingPageOptions<T>): UsePaintingPageReturn<T> {
  const { items, hasHydrated, add, remove, update, reorder } = usePaintingList({ providerId, mode })
  const paintings = items as T[]

  const [painting, setPainting] = useState<T>(paintings[0] || getDefaultPainting())
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [generating, setGenerating] = useCache('chat.generating')
  const [isTranslating, setIsTranslating] = useState(false)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [hasInitialized, setHasInitialized] = useState(false)
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)

  const providers = useAllProviders()
  const [autoTranslateWithSpace] = usePreference('chat.input.translate.auto_translate_with_space')

  const provider = providers.find((p) => p.id === providerId)!

  const updatePaintingState = useCallback(
    (updates: Partial<T>) => {
      const updatedPainting = { ...painting, ...updates }
      setPainting(updatedPainting)
      update(updatedPainting)
    },
    [painting, update]
  )

  const onSelectPainting = useCallback(
    (p: T) => {
      if (generating) return
      setPainting(p)
      setCurrentImageIndex(0)
    },
    [generating]
  )

  const onDeletePainting = useCallback(
    (paintingToDelete: T) => {
      if (paintingToDelete.id === painting.id) {
        const currentIndex = paintings.findIndex((p) => p.id === paintingToDelete.id)

        if (currentIndex > 0) {
          setPainting(paintings[currentIndex - 1])
        } else if (paintings.length > 1) {
          setPainting(paintings[1])
        }
      }

      void remove(paintingToDelete)

      const remaining = paintings.filter((p) => p.id !== paintingToDelete.id)
      if (remaining.length === 0) {
        const newPainting = getDefaultPainting()
        add(newPainting)
        setPainting(newPainting)
      }
    },
    [painting, paintings, remove, add, getDefaultPainting]
  )

  const handleAddPainting = useCallback(() => {
    const newPainting = getDefaultPainting()
    const added = add(newPainting) as T
    setPainting(added)
    return added
  }, [add, getDefaultPainting])

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
      updatePaintingState({ prompt: translatedText } as Partial<T>)
    } finally {
      setIsTranslating(false)
    }
  }, [isTranslating, painting.prompt, updatePaintingState])

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
    if (!hasHydrated || hasInitialized) {
      return
    }

    if (paintings.length === 0) {
      const newPainting = getDefaultPainting()
      add(newPainting)
      setPainting(newPainting)
      setHasInitialized(true)
      return
    }

    setPainting((current) => paintings.find((item) => item.id === current.id) || paintings[0])
    setHasInitialized(true)
  }, [paintings, hasHydrated, hasInitialized, add, getDefaultPainting])

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
    currentImageIndex,
    isLoading,
    setIsLoading,
    isTranslating,
    generating: generating as boolean | undefined,
    setGenerating,
    abortController,
    setAbortController,
    provider,

    updatePaintingState,
    onSelectPainting,
    onDeletePainting,
    handleAddPainting,
    onCancel,
    prevImage,
    nextImage,
    handleProviderChange,
    handleKeyDown,
    reorder: reorder as (paintings: T[]) => void,

    translate
  }
}
