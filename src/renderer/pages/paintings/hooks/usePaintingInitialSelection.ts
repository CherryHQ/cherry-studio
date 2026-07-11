import { useEffect, useRef } from 'react'

import { createDefaultPainting } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'

interface UsePaintingInitialSelectionInput {
  currentPainting: PaintingData
  historyItems: PaintingData[]
  initialProviderId: string
  setCurrentPainting: (painting: PaintingData) => void
}

function isUntouchedDraft(painting: PaintingData) {
  return (
    !painting.persistedAt &&
    !painting.model &&
    !painting.prompt &&
    painting.files.length === 0 &&
    (painting.inputFiles?.length ?? 0) === 0 &&
    Object.keys(painting.params ?? {}).length === 0 &&
    !painting.generationStatus
  )
}

/**
 * Bootstrap the page's first painting once:
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
  const bootstrappedRef = useRef(false)

  useEffect(() => {
    if (bootstrappedRef.current) return

    if (historyItems.length > 0) {
      bootstrappedRef.current = true
      if (!historyItems.some((item) => item.id === currentPainting.id) && isUntouchedDraft(currentPainting)) {
        setCurrentPainting(historyItems[0])
      }
      return
    }

    if (currentPainting.persistedAt || !isUntouchedDraft(currentPainting)) {
      bootstrappedRef.current = true
      return
    }

    if (initialProviderId && currentPainting.providerId !== initialProviderId) {
      setCurrentPainting(createDefaultPainting(initialProviderId))
    }
  }, [currentPainting, historyItems, initialProviderId, setCurrentPainting])
}
