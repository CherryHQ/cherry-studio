import { cacheService } from '@data/CacheService'
import {
  getThinkModelType,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  MODEL_SUPPORTED_OPTIONS,
  MODEL_SUPPORTED_REASONING_EFFORT
} from '@renderer/config/models'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import type { ThinkingOption } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
import { useEffect, useMemo, useRef } from 'react'

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
  const settingsRef = useRef(settings)

  const v1Model = useMemo(() => (model ? fromSharedModel(model) : undefined), [model])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    if (!assistantId || !v1Model) return
    const current = settingsRef.current
    if (!current) return

    const currentReasoningEffort = current.reasoning_effort
    const cacheKey = `assistant.reasoning_effort_cache.${assistantId}` as const

    if (isSupportedThinkingTokenModel(v1Model) || isSupportedReasoningEffortModel(v1Model)) {
      const modelType = getThinkModelType(v1Model)
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
