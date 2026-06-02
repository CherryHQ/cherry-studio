import { useEffect, useRef } from 'react'

import { createDefaultPainting } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'

interface UsePaintingInitialSelectionInput {
  currentPainting: PaintingData
  historyItems: PaintingData[]
  initialProviderId: string
  setCurrentPainting: (painting: PaintingData) => void
}

/**
 * Bootstrap the page's first painting while `currentPainting` is still the
 * untouched mount-time draft (reference equality — every mutation path
 * replaces the reference, so once the user touches anything no branch fires
 * again):
 *
 *   - History resolved non-empty → adopt the most recent persisted painting.
 *   - Fresh user (no history) → re-seed the draft on the resolved provider.
 *     The mount-time draft pins the fallback provider because `providerOptions`
 *     is still `[]` then; once they resolve, a user whose default ≠ the
 *     fallback would otherwise stay pinned to a provider with an empty model
 *     list and be unable to generate.
 */
export function usePaintingInitialSelection({
  currentPainting,
  historyItems,
  initialProviderId,
  setCurrentPainting
}: UsePaintingInitialSelectionInput) {
  const initialDraftRef = useRef(currentPainting)

  useEffect(() => {
    if (currentPainting !== initialDraftRef.current) return

    if (historyItems.length > 0) {
      setCurrentPainting(historyItems[0])
      return
    }

    if (initialProviderId && currentPainting.providerId !== initialProviderId) {
      // Track the re-seeded draft so a later history load still replaces it.
      const reseeded = createDefaultPainting(initialProviderId)
      initialDraftRef.current = reseeded
      setCurrentPainting(reseeded)
    }
  }, [currentPainting, historyItems, initialProviderId, setCurrentPainting])
}
