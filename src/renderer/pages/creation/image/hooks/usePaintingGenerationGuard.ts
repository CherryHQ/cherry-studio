import { useCallback } from 'react'

import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { usePaintingProviderRuntime } from './usePaintingProviderRuntime'

export type PaintingGenerationGuardReason =
  | 'provider_disabled'
  | 'model_missing'
  | 'model_unavailable'
  | 'catalog_error'

export type PaintingGenerationGuardResult =
  | { ok: true }
  | { ok: false; reason: PaintingGenerationGuardReason; error?: Error }

interface UsePaintingGenerationGuardInput {
  painting: Pick<PaintingData, 'providerId' | 'mode' | 'model'>
  ensureCurrentCatalog: () => Promise<ModelOption[]>
}

export function usePaintingGenerationGuard({ painting, ensureCurrentCatalog }: UsePaintingGenerationGuardInput) {
  const providerId = painting.providerId
  const modelId = painting.model
  const { provider } = usePaintingProviderRuntime(providerId)

  const validateBeforeGenerate = useCallback(async (): Promise<PaintingGenerationGuardResult> => {
    // Keyless-permissive: no API-key pre-check (consistent with chat/agent) — a
    // provider that needs a key fails naturally at request time. Enablement is
    // still enforced; the model selector does not pre-block when disabled.
    if (!provider.isEnabled) {
      return { ok: false, reason: 'provider_disabled' }
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

    const ensuredOption = ensuredOptions.find((option) => option.value === modelId)
    if (!ensuredOption || ensuredOption.isEnabled === false) {
      return { ok: false, reason: 'model_unavailable' }
    }

    return { ok: true }
  }, [ensureCurrentCatalog, modelId, provider])

  return { validateBeforeGenerate }
}
