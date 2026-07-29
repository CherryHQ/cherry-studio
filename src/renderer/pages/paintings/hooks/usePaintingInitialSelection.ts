import { useEffect, useRef, useState } from 'react'

import { createDefaultPainting } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'

interface UsePaintingInitialSelectionInput {
  currentPainting: PaintingData
  historyItems: PaintingData[]
  historyIsLoading: boolean
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
 *   - History resolved empty → expose the fresh draft, then re-seed it if the
 *     resolved default provider changes later.
 *     The mount-time draft pins the fallback provider because `providerOptions`
 *     is still `[]` then; once they resolve, a user whose default ≠ the
 *     fallback would otherwise stay pinned to a provider with an empty model
 *     list and be unable to generate.
 *
 * Readiness is committed in the same effect as any initial painting adoption,
 * preventing the empty-state showcase from rendering between history hydration
 * and the selected persisted painting.
 */
export function usePaintingInitialSelection({
  currentPainting,
  historyItems,
  historyIsLoading,
  initialProviderId,
  setCurrentPainting
}: UsePaintingInitialSelectionInput): boolean {
  const [isReady, setIsReady] = useState(false)
  const initialSelectionSettledRef = useRef(false)
  const initialHistoryWasEmptyRef = useRef(false)
  const bootstrapDraftIdRef = useRef(currentPainting.id)

  useEffect(() => {
    if (!initialSelectionSettledRef.current) {
      if (historyIsLoading) return

      initialSelectionSettledRef.current = true
      initialHistoryWasEmptyRef.current = historyItems.length === 0

      if (historyItems.length > 0) {
        if (
          currentPainting.id === bootstrapDraftIdRef.current &&
          !historyItems.some((item) => item.id === currentPainting.id) &&
          isUntouchedDraft(currentPainting)
        ) {
          setCurrentPainting(historyItems[0])
        }
        setIsReady(true)
        return
      }

      setIsReady(true)
    }

    // A genuinely fresh user may resolve their preferred provider after the
    // empty history. Keep that later re-seed path alive without reopening
    // initial history selection or suppressing explicit new drafts.
    if (!initialHistoryWasEmptyRef.current) return
    if (currentPainting.id !== bootstrapDraftIdRef.current) return
    if (currentPainting.persistedAt || !isUntouchedDraft(currentPainting)) return

    if (initialProviderId && currentPainting.providerId !== initialProviderId) {
      const nextPainting = createDefaultPainting(initialProviderId)
      bootstrapDraftIdRef.current = nextPainting.id
      setCurrentPainting(nextPainting)
    }
  }, [currentPainting, historyIsLoading, historyItems, initialProviderId, setCurrentPainting])

  return isReady
}
