import { useEffect, useRef } from 'react'

import type { PaintingData } from '../model/types/paintingData'
import { usePaintingItems } from './usePaintingItems'

interface UsePaintingInitialSelectionInput {
  currentPainting: PaintingData
  setCurrentPainting: (painting: PaintingData) => void
}

/**
 * One-shot bootstrap: when the painting list first loads non-empty AND
 * `currentPainting` is still the very first draft created at mount,
 * replace it with the most recent persisted painting.
 *
 * Reference equality with the initial draft is sufficient — every mutation
 * path (`patchPainting`, `setCurrentPainting`) replaces the reference, so
 * once the user touches anything the guard will never pass again.
 */
export function usePaintingInitialSelection({ currentPainting, setCurrentPainting }: UsePaintingInitialSelectionInput) {
  const { items } = usePaintingItems()
  const initialDraftRef = useRef(currentPainting)

  useEffect(() => {
    if (items.length === 0) return
    if (currentPainting !== initialDraftRef.current) return
    setCurrentPainting(items[0])
  }, [currentPainting, items, setCurrentPainting])
}
