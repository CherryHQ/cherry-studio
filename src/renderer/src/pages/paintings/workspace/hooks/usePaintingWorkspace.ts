import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import type { Provider } from '@renderer/types/provider'
import type { PaintingMode } from '@shared/data/types/painting'
import { useCallback, useEffect, useRef } from 'react'

import { abortPaintingGeneration, clearPaintingAbortController } from '../../model/runtime/paintingAbortControllerStore'
import { clearPaintingRuntimeState } from '../../model/runtime/paintingRuntimeStore'
import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingGeneration } from './usePaintingGeneration'
import { usePaintingSelection } from './usePaintingSelection'
import { usePromptTranslationShortcut } from './usePromptTranslationShortcut'

export interface UsePaintingWorkspaceOptions<T extends PaintingData = PaintingData> {
  providerId: string
  mode?: PaintingMode
  createDefaultPaintingData: () => T
  onProviderChange: (id: string) => void
}

export interface UsePaintingWorkspaceReturn<T extends PaintingData = PaintingData> {
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

export function usePaintingWorkspace<T extends PaintingData = PaintingData>({
  providerId,
  mode,
  createDefaultPaintingData,
  onProviderChange
}: UsePaintingWorkspaceOptions<T>): UsePaintingWorkspaceReturn<T> {
  const { items, isReady, createPainting, deletePainting, updatePainting, reorderPaintings } = usePaintings({
    providerId,
    mode
  })
  const paintings = items as T[]

  const providers = useAllProviders()
  const provider = (providers.find((item) => item.id === providerId) ?? { id: providerId }) as Provider
  const deletedPaintingIdsRef = useRef(new Set<string>())

  const selection = usePaintingSelection({
    providerId,
    mode,
    paintings,
    isReady,
    createDefaultPaintingData
  })
  const { painting, selectedPaintingId, setSelectedPaintingId, currentImageIndex, setCurrentImageIndex } = selection

  const generation = usePaintingGeneration(painting.id)

  useEffect(() => {
    const deletedPaintingIds = deletedPaintingIdsRef.current
    for (const existingPainting of paintings) {
      deletedPaintingIds.delete(existingPainting.id)
    }
  }, [paintings])

  const patchPaintingById = useCallback(
    (paintingId: string, updates: Partial<T>) => {
      if (deletedPaintingIdsRef.current.has(paintingId)) {
        return
      }

      const targetPainting =
        paintings.find((item) => item.id === paintingId) ??
        (painting.id === paintingId ? painting : ({ id: paintingId, files: [] } as unknown as T))
      const updatedPainting = { ...targetPainting, ...updates }

      if (paintings.some((item) => item.id === paintingId)) {
        updatePainting(updatedPainting)
      } else {
        createPainting(updatedPainting)
        setSelectedPaintingId(updatedPainting.id)
      }
    },
    [createPainting, painting, paintings, setSelectedPaintingId, updatePainting]
  )

  const patchPainting = useCallback(
    (updates: Partial<T>) => {
      patchPaintingById(painting.id, updates)
    },
    [painting.id, patchPaintingById]
  )

  const translation = usePromptTranslationShortcut({
    prompt: painting.prompt,
    onTranslated: (translated) => {
      patchPainting({ prompt: translated } as Partial<T>)
    }
  })

  const onDeletePainting = useCallback(
    (paintingToDelete: T) => {
      const remaining = paintings.filter((item) => item.id !== paintingToDelete.id)
      deletedPaintingIdsRef.current.add(paintingToDelete.id)

      abortPaintingGeneration(paintingToDelete.id)
      clearPaintingAbortController(paintingToDelete.id)
      clearPaintingRuntimeState(paintingToDelete.id)

      if (paintingToDelete.id === painting.id) {
        const currentIndex = paintings.findIndex((item) => item.id === paintingToDelete.id)

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
    [deletePainting, painting.id, paintings, setSelectedPaintingId]
  )

  const handleAddPainting = useCallback(() => {
    const newPaintingData = createDefaultPaintingData()
    const added = createPainting(newPaintingData) as T
    setSelectedPaintingId(added.id)
    setCurrentImageIndex(0)
    return added
  }, [createPainting, createDefaultPaintingData, setCurrentImageIndex, setSelectedPaintingId])

  const setPainting = useCallback(
    (nextPainting: T) => {
      setSelectedPaintingId(nextPainting.id)

      if (paintings.some((item) => item.id === nextPainting.id)) {
        updatePainting(nextPainting)
      }
    },
    [paintings, setSelectedPaintingId, updatePainting]
  )

  const handleProviderChange = useCallback(
    (newProviderId: string) => {
      if (newProviderId !== providerId) {
        onProviderChange(newProviderId)
      }
    },
    [onProviderChange, providerId]
  )

  return {
    painting,
    setPainting,
    paintings,
    selectedPaintingId,
    setSelectedPaintingId,
    currentImageIndex,
    isLoading: generation.isLoading,
    setIsLoading: generation.setIsLoading,
    isTranslating: translation.isTranslating,
    provider,
    fallbackUrls: generation.fallbackUrls,
    setFallbackUrls: generation.setFallbackUrls,
    setFallbackUrlsForPainting: generation.setFallbackUrlsForPainting,
    setIsLoadingForPainting: generation.setIsLoadingForPainting,
    patchPainting,
    patchPaintingById,
    onSelectPainting: selection.onSelectPainting,
    onDeletePainting,
    handleAddPainting,
    onCancel: generation.onCancel,
    prevImage: selection.prevImage,
    nextImage: selection.nextImage,
    handleProviderChange,
    handleKeyDown: translation.handleKeyDown,
    reorder: reorderPaintings as (paintings: T[]) => void,
    translate: translation.translate
  }
}
