import { useCallback, useRef } from 'react'

import type { ComposerDraft } from '../model/composerDraft'
import type { ModelOption } from '../model/types/paintingModel'
import { presentPaintingGenerationGuardFeedback } from '../utils/presentPaintingGenerationGuardFeedback'
import { usePaintingGeneration } from './usePaintingGeneration'
import { usePaintingGenerationGuard } from './usePaintingGenerationGuard'

interface UsePaintingGenerationSubmitInput {
  draft: ComposerDraft
  ensureCurrentCatalog: () => Promise<ModelOption[]>
}

/**
 * Single owner of the painting generation submit lifecycle:
 * `validateBeforeGenerate -> generate`. Exposes the in-flight card (transient
 * spinner node) and `cancel(paintingId)` so list-side flows (cancel-before-delete)
 * can target a specific card.
 */
export function usePaintingGenerationSubmit({ draft, ensureCurrentCatalog }: UsePaintingGenerationSubmitInput) {
  const { validateBeforeGenerate } = usePaintingGenerationGuard({ painting: draft, ensureCurrentCatalog })
  const { generate, cancel, inflightCards } = usePaintingGeneration({ draft })

  const submittingRef = useRef(false)

  const submit = useCallback(async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      const guardResult = await validateBeforeGenerate()
      if (!guardResult.ok) {
        presentPaintingGenerationGuardFeedback(guardResult.reason, guardResult.error, draft.providerId)
        return
      }
      await generate()
    } finally {
      submittingRef.current = false
    }
  }, [generate, draft.providerId, validateBeforeGenerate])

  return { inflightCards, submit, cancel }
}
