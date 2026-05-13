import { useCallback } from 'react'

import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { resolvePaintingProviderDefinition, resolvePaintingTabForMode } from '../utils/paintingProviderMode'

interface UsePaintingModelSwitchInput {
  painting: PaintingData
  onPaintingChange: (updates: Partial<PaintingData>) => void
  currentModelOptions: ModelOption[]
  ensureProviderCatalog: (providerId: string) => Promise<ModelOption[]>
}

export type PaintingModelSelection = { providerId: string; modelId: string }

export function usePaintingModelSwitch({
  painting,
  onPaintingChange,
  currentModelOptions,
  ensureProviderCatalog
}: UsePaintingModelSwitchInput) {
  const currentProviderId = painting.providerId

  return useCallback(
    async ({ providerId, modelId }: PaintingModelSelection) => {
      if (providerId === currentProviderId) {
        const currentDefinition = resolvePaintingProviderDefinition(currentProviderId)
        const modelUpdates = currentDefinition.fields.onModelChange?.({
          modelId,
          painting,
          modelOptions: currentModelOptions
        })
        onPaintingChange({ model: modelId, ...modelUpdates } as Partial<PaintingData>)
        return
      }

      const targetDefinition = resolvePaintingProviderDefinition(providerId)
      const targetTab = resolvePaintingTabForMode(targetDefinition, painting.mode)
      if (!targetTab) return

      const targetDbMode = targetDefinition.mode.tabToDbMode(targetTab)
      const targetModelOptions = await ensureProviderCatalog(providerId)
      const targetPainting =
        providerId === painting.providerId
          ? painting
          : targetDefinition.mode.createPaintingData({ tab: targetTab, modelOptions: targetModelOptions })
      const modelUpdates = targetDefinition.fields.onModelChange?.({
        modelId,
        painting: targetPainting,
        modelOptions: targetModelOptions
      })

      onPaintingChange({
        ...targetPainting,
        id: painting.id,
        files: painting.files,
        prompt: painting.prompt,
        providerId,
        mode: targetDbMode,
        model: modelId,
        ...modelUpdates
      } as Partial<PaintingData>)
    },
    [currentModelOptions, currentProviderId, ensureProviderCatalog, onPaintingChange, painting]
  )
}
