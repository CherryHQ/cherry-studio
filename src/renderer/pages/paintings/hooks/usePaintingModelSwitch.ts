import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { isEditImageModel } from '@shared/utils/model'
import { useCallback } from 'react'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import { createDefaultPainting } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { computeModelFieldReset } from '../utils/computeModelFieldReset'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'

const logger = loggerService.withContext('paintings/usePaintingModelSwitch')

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
  const { models } = useModels(currentProviderId ? { providerId: currentProviderId } : undefined)

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
        // Drop attached input images when the target model can't accept them:
        // the prompt-bar upload UI is gated on `isEditImageModel`, so a hidden
        // attachment left over from an edit model would otherwise still be
        // sent to a generate-only model. `onPaintingChange` merges, so the
        // clear must be explicit.
        const nextModel = models.find((model) => model.apiModelId === modelId)
        const keepInputFiles = nextModel ? isEditImageModel(nextModel) : false
        onPaintingChange({
          params: { ...painting.params, ...resetPatch },
          model: modelId,
          ...(keepInputFiles ? {} : { inputFiles: [] })
        } as Partial<PaintingData>)
        return
      }

      try {
        await ensureProviderCatalog(providerId)
      } catch (error) {
        // Cold-cache + DB/IPC failure must not silently revert the dropdown —
        // surface it like the generate path instead of swallowing the switch.
        logger.error('Failed to load provider catalog on model switch', error as Error)
        presentPaintingGenerateError(error)
        return
      }
      const targetPainting = createDefaultPainting(providerId)

      onPaintingChange({
        ...targetPainting,
        id: painting.id,
        files: painting.files,
        prompt: painting.prompt,
        providerId,
        mode: 'generate',
        model: modelId,
        // Switching providers resets the form context; never carry input
        // images across to a different provider's model.
        inputFiles: []
      } as Partial<PaintingData>)
    },
    [currentProviderId, ensureProviderCatalog, models, onPaintingChange, painting]
  )
}
