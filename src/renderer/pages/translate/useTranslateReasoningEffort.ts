/**
 * Translate's reasoning-effort selection, read alongside the configured model.
 *
 * The stored selection is never rewritten to fit the current model, matching
 * what the composers do. Main resolves the stored value per request instead:
 * to the nearest effort the model does declare, or — when it declares none at
 * all, or cannot turn thinking off — to no reasoning parameter. So pointing
 * translate at a model with a narrower vocabulary, including when picking a
 * default model cascades into `feature.translate.model_id`, costs the user
 * nothing, and pointing it back returns the effort they chose.
 *
 * The display is more conservative than the wire: `ModelSpeedControl` shows
 * provider Default for an effort the model does not declare, while the request
 * carries the nearest one. That split is the composers' too — worth knowing
 * when reading a log line that names an effort the popover never showed.
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
