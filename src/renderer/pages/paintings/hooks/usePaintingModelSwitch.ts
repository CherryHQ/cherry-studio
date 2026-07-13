import { loggerService } from '@logger'
import { useCallback } from 'react'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import type { ComposerDraft } from '../model/composerDraft'
import type { ModelOption } from '../model/types/paintingModel'
import { computeModelFieldReset } from '../utils/computeModelFieldReset'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'

const logger = loggerService.withContext('paintings/usePaintingModelSwitch')

interface UsePaintingModelSwitchInput {
  draft: ComposerDraft
  onDraftChange: (updates: Partial<ComposerDraft>) => void
  ensureProviderCatalog: (providerId: string) => Promise<ModelOption[]>
}

export type PaintingModelSelection = { providerId: string; modelId: string }

/**
 * Switch the draft's model/provider. It only ever touches `model` and `params`
 * (+ `providerId` cross-provider) — **never** `inputFiles` or `sessionId`. Input
 * images are provider-agnostic file references the user attached on purpose;
 * dropping a model's image-input support is decided at generation time, not here,
 * and keeping the session id means the composer does not remount on a switch.
 */
export function usePaintingModelSwitch({ draft, onDraftChange, ensureProviderCatalog }: UsePaintingModelSwitchInput) {
  const currentProviderId = draft.providerId

  return useCallback(
    async ({ providerId, modelId }: PaintingModelSelection) => {
      if (providerId === currentProviderId) {
        // Reset stale params the old model wrote but the new one doesn't accept;
        // the form writes into `params`, so the reset patch lives there too.
        // `{}` when either model is unknown to the registry → custom-id drafts
        // stay untouched.
        const resetPatch = await computeModelFieldReset({
          providerId: currentProviderId,
          oldModelId: draft.model,
          newModelId: modelId,
          mode: tabToImageGenerationMode(draft.mode),
          currentValues: draft.params
        })
        onDraftChange({ model: modelId, params: { ...draft.params, ...resetPatch } })
        return
      }

      try {
        await ensureProviderCatalog(providerId)
      } catch (error) {
        // Cold-cache + DB/IPC failure must not silently revert the dropdown.
        logger.error('Failed to load provider catalog on model switch', error as Error)
        presentPaintingGenerateError(error)
        return
      }

      // Cross-provider: the new model has a different param vocabulary, so reset
      // `params`. Keep `prompt`, `mode`, `inputFiles`, and the session id.
      onDraftChange({ providerId, model: modelId, params: {} })
    },
    [currentProviderId, draft.model, draft.mode, draft.params, ensureProviderCatalog, onDraftChange]
  )
}
