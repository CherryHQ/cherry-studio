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
        // Reset stale fields the old model wrote but the new one doesn't
        // accept — otherwise the flat `PaintingData` carries them through
        // to the vendor's `generateUnified.ts` and they land in the wire
        // body. The form already hides those fields (driven by the
        // registry's per-model `imageGeneration` block); this brings the
        // state into sync. Returns `{}` when either model is unknown to
        // the registry, so custom-id paintings stay untouched.
        const currentTab =
          resolvePaintingTabForMode(currentDefinition, painting.mode) ?? currentDefinition.mode.defaultTab
        const resetPatch = await computeModelFieldReset({
          providerId: currentProviderId,
          oldModelId: painting.model,
          newModelId: modelId,
          mode: tabToImageGenerationMode(currentDefinition.mode.tabToDbMode(currentTab)),
          currentValues: (painting.params ?? {}) as Record<string, unknown>
        })
        onPaintingChange({ ...resetPatch, model: modelId, ...modelUpdates } as Partial<PaintingData>)
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
