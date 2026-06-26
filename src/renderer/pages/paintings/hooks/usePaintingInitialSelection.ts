import { useEffect, useRef } from 'react'

import { type ComposerDraft, createDraft } from '../model/composerDraft'

interface UsePaintingInitialSelectionInput {
  draft: ComposerDraft
  initialProviderId: string
  setDraft: (draft: ComposerDraft) => void
}

/**
 * Re-seed the untouched mount-time draft onto the resolved provider once
 * `providerOptions` load. The mount-time draft pins the fallback provider while
 * options are still `[]`; once they resolve, a user whose default ≠ the fallback
 * would otherwise stay pinned to a provider with an empty model list.
 *
 * The composer is an **independent draft** — it is never auto-bound to a
 * persisted card. Selecting/loading history does not refill it (reference
 * equality on `initialDraftRef`: once the user touches anything, this stops).
 */
export function usePaintingInitialSelection({ draft, initialProviderId, setDraft }: UsePaintingInitialSelectionInput) {
  const initialDraftRef = useRef(draft)

  useEffect(() => {
    if (draft !== initialDraftRef.current) return

    if (initialProviderId && draft.providerId !== initialProviderId) {
      const reseeded = createDraft(initialProviderId)
      initialDraftRef.current = reseeded
      setDraft(reseeded)
    }
  }, [draft, initialProviderId, setDraft])
}
