/**
 * Translate's reasoning-effort selection, read alongside the configured model.
 *
 * The stored selection is never rewritten to fit the current model, matching
 * what the composers do: `ModelSpeedControl` shows provider Default for an
 * effort this model does not declare, and Main degrades the same selection to
 * "send no reasoning parameter". So pointing translate at a model with a
 * narrower vocabulary — including when picking a default model cascades into
 * `feature.translate.model_id` — costs the user nothing, and pointing it back
 * returns the effort they chose.
 */

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useModelById } from '@renderer/hooks/useModel'
import { deriveThinkingOptions } from '@shared/ai/reasoning'
import { isUniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { useCallback, useEffect } from 'react'

const logger = loggerService.withContext('useTranslateReasoningEffort')

export function useTranslateReasoningEffort() {
  const [modelId] = usePreference('feature.translate.model_id')
  const { model, error } = useModelById(modelId && isUniqueModelId(modelId) ? modelId : null)
  const [effort, setEffort] = usePreference('feature.translate.reasoning_effort')

  // A model row that fails to resolve hides the control, which on screen is
  // indistinguishable from a model that simply cannot reason.
  useEffect(() => {
    if (error) logger.error('Failed to resolve the translate model', error, { modelId })
  }, [error, modelId])

  const selectEffort = useCallback(
    (next: ReasoningEffortOption) => {
      setEffort(next).catch((err) => logger.error('Failed to persist translate reasoning effort', err as Error))
    },
    [setEffort]
  )

  // Matches the control's own visibility rule: more than a bare 'default'.
  const supportsReasoning = model ? (deriveThinkingOptions(model)?.length ?? 0) > 1 : false

  return { model, effort, selectEffort, supportsReasoning }
}
