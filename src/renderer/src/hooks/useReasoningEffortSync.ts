/**
 * Sync an assistant's `reasoning_effort` setting to a value the active model
 * actually supports.
 *
 * Triggered whenever `model` changes:
 *  - Switching to a thinking model whose supported options don't include the
 *    current effort → fall back to a cached choice (if still supported) or
 *    the model's default option, and persist the chosen value back to the
 *    `assistant.reasoning_effort_cache.${assistantId}` cache.
 *  - Switching to a non-thinking model → save the current effort to cache
 *    (so it can be restored later) and clear `reasoning_effort` /
 *    `qwenThinkMode` on the assistant.
 *
 * Extracted from `useAssistant.ts` so the v2 read path can call it without
 * pulling in Redux selectors.
 */

import { cacheService } from '@data/CacheService'
import {
  getThinkModelType,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  MODEL_SUPPORTED_OPTIONS,
  MODEL_SUPPORTED_REASONING_EFFORT
} from '@renderer/config/models'
// Model is still v1-shaped here — the supported-effort utilities above read
// `model.id` as a bare modelId (renderer convention). Migration to v2 Model
// is a separate effort tracked in the assistant migration plan.
import type { Model, ThinkingOption } from '@renderer/types'
import { useEffect, useRef } from 'react'

/** The minimal settings slice this hook reads/writes — keeps the contract
 *  compatible with both v1 and v2 `AssistantSettings` shapes (the two diverge
 *  on `customParameters`'s discriminator, which we don't touch here). */
export type ReasoningEffortPatch = {
  reasoning_effort?: string
  qwenThinkMode?: boolean
}

export function useReasoningEffortSync(
  assistantId: string | undefined,
  model: Model | undefined,
  settings: { reasoning_effort?: string } | undefined,
  updateAssistantSettings: (next: ReasoningEffortPatch) => void
) {
  // Latest settings snapshot — read inside the effect without re-running on
  // every settings tick (only model changes drive this sync).
  const settingsRef = useRef(settings)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    if (!assistantId || !model) return
    const current = settingsRef.current
    if (!current) return

    const currentReasoningEffort = current.reasoning_effort
    const cacheKey = `assistant.reasoning_effort_cache.${assistantId}` as const

    if (isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) {
      const modelType = getThinkModelType(model)
      const supportedOptions = MODEL_SUPPORTED_OPTIONS[modelType]
      if (supportedOptions.every((option) => option !== currentReasoningEffort)) {
        const cached = cacheService.get(cacheKey) as ThinkingOption | undefined
        const fallback: ThinkingOption =
          cached && supportedOptions.includes(cached)
            ? cached
            : currentReasoningEffort !== undefined
              ? MODEL_SUPPORTED_REASONING_EFFORT[modelType][0]
              : MODEL_SUPPORTED_OPTIONS[modelType][0]

        cacheService.set(cacheKey, fallback === 'none' ? undefined : fallback)
        updateAssistantSettings({
          reasoning_effort: fallback === 'none' ? undefined : fallback,
          qwenThinkMode: fallback === 'none' ? undefined : true
        })
      }
      return
    }

    // Switched to a non-thinking model: stash the current choice and clear.
    if (currentReasoningEffort !== undefined) {
      cacheService.set(cacheKey, currentReasoningEffort)
    }
    updateAssistantSettings({
      reasoning_effort: undefined,
      qwenThinkMode: undefined
    })
  }, [model, assistantId, updateAssistantSettings])
}
