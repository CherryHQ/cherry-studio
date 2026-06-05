import { useCallback, useRef } from 'react'

import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { presentPaintingGenerationGuardFeedback } from '../utils/presentPaintingGenerationGuardFeedback'
import { usePaintingGeneration } from './usePaintingGeneration'
import { usePaintingGenerationGuard } from './usePaintingGenerationGuard'

interface UsePaintingGenerationSubmitInput {
  painting: PaintingData
  onPaintingChange: (painting: PaintingData) => void
  ensureCurrentCatalog: () => Promise<ModelOption[]>
}

/**
 * Single owner of the painting generation submit lifecycle:
 * `validateBeforeGenerate -> generate`, plus cancel + generating state.
 *
 * `cancel(paintingId)` keeps the original signature so list-side flows
 * (e.g. cancel-before-delete) can target a specific painting.
 */
export function usePaintingGenerationSubmit({
  painting,
  onPaintingChange,
  ensureCurrentCatalog
}: UsePaintingGenerationSubmitInput) {
  const { validateBeforeGenerate } = usePaintingGenerationGuard({
    painting,
    ensureCurrentCatalog
  })
  const { generate, cancel, generating } = usePaintingGeneration({
    painting,
    onPaintingChange
  })

  const submittingRef = useRef(false)

  const submit = useCallback(async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      const guardResult = await validateBeforeGenerate()
      if (!guardResult.ok) {
        presentPaintingGenerationGuardFeedback(guardResult.reason, guardResult.error, painting.providerId)
        return
      }
      await generate()
    } finally {
      submittingRef.current = false
    }
  }, [generate, painting.providerId, validateBeforeGenerate])

  return { generating, submit, cancel }
}
