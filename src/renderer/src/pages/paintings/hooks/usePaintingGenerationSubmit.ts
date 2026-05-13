import { useCallback } from 'react'

import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { presentPaintingGenerationGuardFeedback } from '../utils/presentPaintingGenerationGuardFeedback'
import { usePaintingGeneration } from './usePaintingGeneration'
import { usePaintingGenerationGuard } from './usePaintingGenerationGuard'
import type { PaintingModelCatalogData } from './usePaintingModelCatalog'

interface UsePaintingGenerationSubmitInput {
  painting: PaintingData
  onPaintingChange: (painting: PaintingData) => void
  selectorData: PaintingModelCatalogData
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
  selectorData,
  ensureCurrentCatalog
}: UsePaintingGenerationSubmitInput) {
  const { validateBeforeGenerate } = usePaintingGenerationGuard({
    painting,
    selectorData,
    ensureCurrentCatalog
  })
  const { generate, cancel, generating } = usePaintingGeneration({
    painting,
    onPaintingChange
  })

  const submit = useCallback(async () => {
    const guardResult = await validateBeforeGenerate()
    if (!guardResult.ok) {
      presentPaintingGenerationGuardFeedback(guardResult.reason, guardResult.error, painting.providerId)
      return
    }
    await generate()
  }, [generate, painting.providerId, validateBeforeGenerate])

  return { generating, submit, cancel }
}
