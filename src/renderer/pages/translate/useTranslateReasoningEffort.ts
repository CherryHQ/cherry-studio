/**
 * Translate's reasoning-effort selection, resolved against the configured
 * translate model.
 *
 * The settings panel and the page toolbar both edit the same preference, so the
 * reconciliation lives here instead of at either call site — the translate model
 * also changes out-of-band, when picking a default model cascades into it.
 */

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useModelById } from '@renderer/hooks/useModel'
import { deriveThinkingOptions, resolveReasoningEffortForModel } from '@shared/ai/reasoning'
import { isUniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { useCallback, useEffect, useMemo } from 'react'

const logger = loggerService.withContext('useTranslateReasoningEffort')

export function useTranslateReasoningEffort() {
  const [modelId] = usePreference('feature.translate.model_id')
  const { model } = useModelById(modelId && isUniqueModelId(modelId) ? modelId : null)
  const [effort, setEffort] = usePreference('feature.translate.reasoning_effort')

  const selectEffort = useCallback(
    (next: ReasoningEffortOption) => {
      setEffort(next).catch((error) => logger.error('Failed to persist translate reasoning effort', error as Error))
    },
    [setEffort]
  )

  // Project a stored effort onto the current model's vocabulary and write the
  // result back, so the panel never offers a value this model would reject.
  // Writing only on a real difference keeps this a fixpoint rather than a loop.
  useEffect(() => {
    if (!model) return
    const resolved = resolveReasoningEffortForModel(model, effort)
    if (resolved === undefined || resolved === effort) return
    selectEffort(resolved)
  }, [model, effort, selectEffort])

  // Matches the control's own visibility rule: more than a bare 'default'.
  const supportsReasoning = useMemo(() => (model ? (deriveThinkingOptions(model)?.length ?? 0) > 1 : false), [model])

  return { model, effort, selectEffort, supportsReasoning }
}
