import { useEffect, useRef } from 'react'

import { createDefaultPainting } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'

interface UsePaintingInitialDraftInput {
  currentPainting: PaintingData
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
 * Keep the page's initial empty draft aligned with the resolved default provider.
 *
 * The mount-time draft pins the fallback provider because `providerOptions` is
 * still `[]` then. Re-seed it as soon as those options resolve, unless the user
 * has already edited or replaced the draft.
 */
export function usePaintingInitialDraft({
  currentPainting,
  initialProviderId,
  setCurrentPainting
}: UsePaintingInitialDraftInput): void {
  const bootstrapDraftIdRef = useRef(currentPainting.id)

  useEffect(() => {
    if (currentPainting.id !== bootstrapDraftIdRef.current) return
    if (currentPainting.persistedAt || !isUntouchedDraft(currentPainting)) return

    if (initialProviderId && currentPainting.providerId !== initialProviderId) {
      const nextPainting = createDefaultPainting(initialProviderId)
      bootstrapDraftIdRef.current = nextPainting.id
      setCurrentPainting(nextPainting)
    }
  }, [currentPainting, initialProviderId, setCurrentPainting])
}
