import { useCallback } from 'react'

import { resolveImageCapability } from '@cherrystudio/provider-registry'
import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import { createDefaultPainting } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { computeModelFieldReset } from '../utils/computeModelFieldReset'
import { paintingOperation } from '../utils/paintingProviderMode'

const logger = loggerService.withContext('paintings/usePaintingModelSwitch')

interface UsePaintingModelSwitchInput {
  painting: PaintingData
  onPaintingChange: (updates: Partial<PaintingData>) => void
  ensureProviderCatalog: (providerId: string) => Promise<ModelOption[]>
}

export type PaintingModelSelection = { providerId: string; modelId: string; hasImages: boolean }

export function usePaintingModelSwitch({
  painting,
  onPaintingChange,
  ensureProviderCatalog
}: UsePaintingModelSwitchInput) {
  const currentProviderId = painting.providerId
  const { models } = useModels(currentProviderId ? { providerId: currentProviderId } : undefined)

  return useCallback(
    async ({ providerId, modelId, hasImages }: PaintingModelSelection) => {
      try {
        if (providerId === currentProviderId) {
          const resetPatch = await computeModelFieldReset({
            providerId: currentProviderId,
            oldModelId: painting.model,
            newModelId: modelId,
            operation: paintingOperation(painting.mode),
            currentValues: painting.params ?? {},
            hasImages: hasImages
          })
          const nextModel = models.find((model) => model.apiModelId === modelId)
          const resolution = resolveImageCapability(
            nextModel?.imageGeneration ?? undefined,
            paintingOperation(painting.mode),
            hasImages
          )
          const keepInputFiles = resolution.kind !== 'unsupported'
          onPaintingChange({
            params: { ...painting.params, ...resetPatch },
            model: modelId,
            ...(keepInputFiles ? {} : { inputFiles: [] })
          })
          return
        }

        await ensureProviderCatalog(providerId)
        const targetPainting = createDefaultPainting({ providerId })
        const params = await computeModelFieldReset({
          providerId,
          oldModelId: undefined,
          newModelId: modelId,
          operation: 'generate',
          hasImages: false
        })

        onPaintingChange({
          ...targetPainting,
          id: painting.id,
          files: painting.files,
          prompt: painting.prompt,
          providerId,
          mode: 'generate',
          params,
          model: modelId,
          // Switching providers resets the form context; never carry input
          // images across to a different provider's model.
          inputFiles: []
        })
      } catch (error) {
        logger.error('Failed to prepare painting model switch', error as Error)
        presentPaintingGenerateError(error)
      }
    },
    [currentProviderId, ensureProviderCatalog, models, onPaintingChange, painting]
  )
}
