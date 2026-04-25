/**
 * Compute the reasoning_effort patch needed when switching to `nextModel`.
 *
 * Returns `null` if no patch is needed (current value already supported, or
 * already unset for a non-thinking model). Otherwise returns the partial
 * settings to merge into the same mutation that writes the new modelId, so
 * a single PATCH atomically swaps the model + reconciles the reasoning
 * effort. This replaces the legacy `useReasoningEffortSync` effect, which
 * fired on every SWR revalidate and was the source of a no-op-PATCH loop.
 */
import {
  getThinkModelType,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  MODEL_SUPPORTED_OPTIONS,
  MODEL_SUPPORTED_REASONING_EFFORT
} from '@renderer/config/models'
import { cacheService } from '@renderer/data/CacheService'
import type { Model as V1Model, ThinkingOption } from '@renderer/types'

export type ReasoningEffortPatch = {
  reasoning_effort?: string
  qwenThinkMode?: boolean
}

export function reconcileReasoningEffortForModel(
  nextModel: V1Model,
  currentEffort: string | undefined,
  assistantId: string
): ReasoningEffortPatch | null {
  const cacheKey = `assistant.reasoning_effort_cache.${assistantId}` as const

  if (isSupportedThinkingTokenModel(nextModel) || isSupportedReasoningEffortModel(nextModel)) {
    const modelType = getThinkModelType(nextModel)
    const supportedOptions = MODEL_SUPPORTED_OPTIONS[modelType]
    if (supportedOptions.includes(currentEffort as ThinkingOption)) {
      return null // current value already supported — no PATCH needed
    }
    const cached = cacheService.get(cacheKey) as ThinkingOption | undefined
    const fallback: ThinkingOption =
      cached && supportedOptions.includes(cached)
        ? cached
        : currentEffort !== undefined
          ? MODEL_SUPPORTED_REASONING_EFFORT[modelType][0]
          : MODEL_SUPPORTED_OPTIONS[modelType][0]
    cacheService.set(cacheKey, fallback === 'none' ? undefined : fallback)
    return {
      reasoning_effort: fallback === 'none' ? undefined : fallback,
      qwenThinkMode: fallback === 'none' ? undefined : true
    }
  }

  // Switched to a non-thinking model: stash the current choice and clear.
  if (currentEffort === undefined) return null
  cacheService.set(cacheKey, currentEffort)
  return {
    reasoning_effort: undefined,
    qwenThinkMode: undefined
  }
}
