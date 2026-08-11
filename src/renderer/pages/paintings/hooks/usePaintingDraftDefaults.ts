import { usePreference } from '@data/hooks/usePreference'
import { useModelById } from '@renderer/hooks/useModel'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { useEffect, useMemo } from 'react'

import type { PaintingDraftDefaults } from '../model/paintingPipeline'
import { isAvailablePaintingModel } from '../model/utils/paintingModelOptions'
import { resolvePaintingProvider } from '../utils/providerSelection'

const FALLBACK_PROVIDER = 'zhipu'

/**
 * Resolve the provider + model defaults for a new painting draft. A valid
 * configured painting model owns both values; the legacy provider preference
 * remains the fallback when that model is unavailable.
 */
export function usePaintingDraftDefaults(providerOptions: string[]) {
  const [defaultPaintingProvider, setDefaultPaintingProvider] = usePreference('feature.paintings.default_provider')
  const [defaultPaintingModelId] = usePreference('feature.paintings.default_model_id')
  const { model: defaultPaintingModel } = useModelById(defaultPaintingModelId as UniqueModelId | null)

  const configuredDefault = useMemo(() => {
    if (
      !defaultPaintingModel ||
      !providerOptions.includes(defaultPaintingModel.providerId) ||
      !isAvailablePaintingModel(defaultPaintingModel)
    ) {
      return undefined
    }

    return {
      providerId: defaultPaintingModel.providerId,
      modelId: defaultPaintingModel.apiModelId ?? parseUniqueModelId(defaultPaintingModel.id).modelId
    }
  }, [defaultPaintingModel, providerOptions])

  const resolvedProviderId = useMemo(
    () =>
      resolvePaintingProvider(configuredDefault?.providerId, defaultPaintingProvider ?? undefined, providerOptions) ??
      FALLBACK_PROVIDER,
    [configuredDefault?.providerId, defaultPaintingProvider, providerOptions]
  )

  useEffect(() => {
    // Wait until provider options have loaded before persisting — otherwise
    // the first render persists the FALLBACK_PROVIDER the user never chose.
    if (!defaultPaintingProvider && providerOptions.length > 0) {
      void setDefaultPaintingProvider(resolvedProviderId)
    }
  }, [defaultPaintingProvider, providerOptions.length, resolvedProviderId, setDefaultPaintingProvider])

  const draftDefaults = useMemo<PaintingDraftDefaults>(
    () => ({ providerId: resolvedProviderId, modelId: configuredDefault?.modelId }),
    [configuredDefault?.modelId, resolvedProviderId]
  )

  return draftDefaults
}
