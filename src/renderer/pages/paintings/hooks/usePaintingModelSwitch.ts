import { useCallback, useEffect, useRef } from 'react'

import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import { createDefaultPainting } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { canEditPaintingModel } from '../model/utils/paintingModelOptions'
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

  const selectionVersion = useRef(0)
  useEffect(
    () => () => {
      selectionVersion.current += 1
    },
    [painting.id, currentProviderId]
  )

  return useCallback(
    async ({ providerId, modelId }: PaintingModelSelection) => {
      const version = ++selectionVersion.current
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
        // Match the upload control's capability check so references survive compatible model switches.
        const nextModel = models.find((model) => model.apiModelId === modelId)
        const keepInputFiles = nextModel ? canEditPaintingModel(nextModel) : false
        if (version !== selectionVersion.current) return
        onPaintingChange({
          params: { ...painting.params, ...resetPatch },
          model: modelId,
          ...(keepInputFiles ? {} : { inputFiles: [] })
        })
        return
      }

      try {
        await ensureProviderCatalog(providerId)
      } catch (error) {
        if (version !== selectionVersion.current) return
        // Cold-cache + DB/IPC failure must not silently revert the dropdown —
        // surface it like the generate path instead of swallowing the switch.
        logger.error('Failed to load provider catalog on model switch', error as Error)
        presentPaintingGenerateError(error)
        return
      }
      if (version !== selectionVersion.current) return
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
