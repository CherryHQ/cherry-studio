import { createUniqueModelId } from '@shared/data/types/model'
import { useCallback } from 'react'

import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { resolvePaintingProviderDefinition, resolvePaintingTabForMode } from '../utils/paintingProviderMode'
import type { PaintingModelCatalogData } from './usePaintingModelCatalog'
import { usePaintingProviderRuntime } from './usePaintingProviderRuntime'

export type PaintingGenerationGuardReason =
  | 'provider_disabled'
  | 'mode_unsupported'
  | 'model_missing'
  | 'model_unavailable'
  | 'catalog_error'

export type PaintingGenerationGuardResult =
  | { ok: true }
  | { ok: false; reason: PaintingGenerationGuardReason; error?: Error }

interface UsePaintingGenerationGuardInput {
  painting: Pick<PaintingData, 'providerId' | 'mode' | 'model'>
  selectorData: PaintingModelCatalogData
  ensureCurrentCatalog: () => Promise<ModelOption[]>
}

export function usePaintingGenerationGuard({
  painting,
  selectorData,
  ensureCurrentCatalog
}: UsePaintingGenerationGuardInput) {
  const providerId = painting.providerId
  const mode = painting.mode
  const modelId = painting.model
  const { provider } = usePaintingProviderRuntime(providerId)

  const validateBeforeGenerate = useCallback(async (): Promise<PaintingGenerationGuardResult> => {
    // UX: PaintingModelSelector does not pre-block when disabled (sponsor flows). This is the enforcement point.
    if (!provider.isEnabled) {
      return { ok: false, reason: 'provider_disabled' }
    }

    const definition = resolvePaintingProviderDefinition(providerId)
    if (!resolvePaintingTabForMode(definition, mode)) {
      return { ok: false, reason: 'mode_unsupported' }
    }

    if (!modelId) {
      return { ok: false, reason: 'model_missing' }
    }

    let ensuredOptions: ModelOption[]
    try {
      ensuredOptions = await ensureCurrentCatalog()
    } catch (error) {
      return {
        ok: false,
        reason: 'catalog_error',
        error: error instanceof Error ? error : new Error('Failed to load painting models')
      }
    }

    const uniqueModelId = createUniqueModelId(providerId, modelId)
    const selectedModel = selectorData.models.find((model) => model.id === uniqueModelId)

    if (selectedModel?.isEnabled === false || selectedModel?.isHidden) {
      return { ok: false, reason: 'model_unavailable' }
    }

    if (!selectedModel) {
      const ensuredOption = ensuredOptions.find((option) => option.value === modelId)
      if (!ensuredOption || ensuredOption.isEnabled === false) {
        return { ok: false, reason: 'model_unavailable' }
      }
    }

    return { ok: true }
  }, [ensureCurrentCatalog, mode, modelId, provider.isEnabled, providerId, selectorData.models])

  return { validateBeforeGenerate }
}
