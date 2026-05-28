import { useCallback } from 'react'

import { createDefaultPainting } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { computeModelFieldReset } from '../utils/computeModelFieldReset'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'

interface UsePaintingModelSwitchInput {
  painting: PaintingData
  onPaintingChange: (updates: Partial<PaintingData>) => void
  ensureProviderCatalog: (providerId: string) => Promise<ModelOption[]>
}

export type PaintingModelSelection = { providerId: string; modelId: string }

export function usePaintingModelSwitch({
  painting,
  onPaintingChange,
  ensureProviderCatalog
}: UsePaintingModelSwitchInput) {
  const currentProviderId = painting.providerId

  return useCallback(
    async ({ providerId, modelId }: PaintingModelSelection) => {
      if (providerId === currentProviderId) {
        // Reset stale fields the old model wrote but the new one doesn't
        // accept — the form writes into `painting.params`, so the reset
        // patch lives there too. Form-hiding is driven by the new model's
        // registry block; this brings the underlying values in sync.
        // Returns `{}` when either model is unknown to the registry, so
        // custom-id paintings stay untouched.
        const resetPatch = await computeModelFieldReset({
          providerId: currentProviderId,
          oldModelId: painting.model,
          newModelId: modelId,
          mode: tabToImageGenerationMode(painting.mode),
          currentValues: painting.params ?? {}
        })
        onPaintingChange({
          params: { ...(painting.params ?? {}), ...resetPatch },
          model: modelId
        } as Partial<PaintingData>)
        return
      }

      await ensureProviderCatalog(providerId)
      const targetPainting = providerId === painting.providerId ? painting : createDefaultPainting(providerId)

      onPaintingChange({
        ...targetPainting,
        id: painting.id,
        files: painting.files,
        prompt: painting.prompt,
        providerId,
        mode: 'generate',
        model: modelId
      } as Partial<PaintingData>)
    },
    [currentProviderId, ensureProviderCatalog, onPaintingChange, painting]
  )
}
