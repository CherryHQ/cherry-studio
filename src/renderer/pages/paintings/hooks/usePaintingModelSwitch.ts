import { useCallback } from 'react'

import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import type { Model } from '@shared/data/types/model'
import { isEditImageModel } from '@shared/utils/model'

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

function resolveTargetModel(
  catalog: ModelOption[],
  models: readonly Model[],
  providerId: string,
  modelId: string
): Model | undefined {
  const raw = catalog.find((option) => option.value === modelId)?.raw
  if (raw && typeof raw === 'object' && 'capabilities' in raw) {
    return raw as Model
  }
  return models.find((model) => model.providerId === providerId && model.apiModelId === modelId)
}

export function usePaintingModelSwitch({
  painting,
  onPaintingChange,
  ensureProviderCatalog
}: UsePaintingModelSwitchInput) {
  const currentProviderId = painting.providerId
  const { models } = useModels()

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
          oldProviderId: currentProviderId,
          newProviderId: currentProviderId,
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
        const nextModel = models.find((model) => model.providerId === currentProviderId && model.apiModelId === modelId)
        const keepInputFiles = nextModel ? isEditImageModel(nextModel) : false
        onPaintingChange({
          params: { ...painting.params, ...resetPatch },
          model: modelId,
          ...(keepInputFiles ? {} : { inputFiles: [] })
        })
        return
      }

      let targetCatalog: ModelOption[]
      try {
        targetCatalog = await ensureProviderCatalog(providerId)
      } catch (error) {
        // Cold-cache + DB/IPC failure must not silently revert the dropdown —
        // surface it like the generate path instead of swallowing the switch.
        logger.error('Failed to load provider catalog on model switch', error as Error)
        presentPaintingGenerateError(error)
        return
      }

      // Same apiModelId served by a different provider: the user changed
      // where the model runs, not the model itself. Preserve compatible
      // params (diffed across both providers' registry blocks), keep the
      // current mode, and keep input files unless the target model
      // positively can't accept them.
      if (painting.model !== undefined && painting.model === modelId) {
        const resetPatch = await computeModelFieldReset({
          oldProviderId: currentProviderId,
          newProviderId: providerId,
          oldModelId: painting.model,
          newModelId: modelId,
          mode: tabToImageGenerationMode(painting.mode),
          currentValues: painting.params ?? {}
        })
        const targetModel = resolveTargetModel(targetCatalog, models, providerId, modelId)
        // Unknown target model: preserve attachments rather than wipe them —
        // the ids match, so the target almost certainly accepts what the
        // source accepted. Only clear on positive non-edit evidence.
        const keepInputFiles = targetModel ? isEditImageModel(targetModel) : true
        onPaintingChange({
          params: { ...painting.params, ...resetPatch },
          providerId,
          model: modelId,
          ...(keepInputFiles ? {} : { inputFiles: [] })
        })
        return
      }

      const targetPainting = createDefaultPainting({ providerId })

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
      })
    },
    [currentProviderId, ensureProviderCatalog, models, onPaintingChange, painting]
  )
}
