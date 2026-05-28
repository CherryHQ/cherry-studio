import { useCallback } from 'react'

import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { computeModelFieldReset } from '../utils/computeModelFieldReset'
import {
  resolvePaintingProviderDefinition,
  resolvePaintingTabForMode,
  tabToImageGenerationMode
} from '../utils/paintingProviderMode'

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
        // accept — the flat `PaintingData.params` carries them through to
        // canonicalGenerate's wire bag otherwise. The form already hides
        // those (driven by registry's per-model `imageGeneration` block);
        // this brings state into sync. Returns `{}` when either model is
        // unknown to the registry, so custom-id paintings stay untouched.
        const resetPatch = await computeModelFieldReset({
          providerId: currentProviderId,
          oldModelId: painting.model,
          newModelId: modelId,
          mode: tabToImageGenerationMode(painting.mode),
          currentValues: (painting.params ?? {}) as Record<string, unknown>
        })
        onPaintingChange({ ...resetPatch, model: modelId } as Partial<PaintingData>)
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

      onPaintingChange({
        ...targetPainting,
        id: painting.id,
        files: painting.files,
        prompt: painting.prompt,
        providerId,
        mode: targetDbMode,
        model: modelId
      } as Partial<PaintingData>)
    },
    [currentProviderId, ensureProviderCatalog, onPaintingChange, painting]
  )
}
