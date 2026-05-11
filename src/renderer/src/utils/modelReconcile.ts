/**
 * Pure reconciliation utilities for "switching to a new model" mutations.
 *
 * Consumers (`useAssistant.setModel`, settings pages) call these to compute
 * the partial settings patch needed when the model changes, then merge the
 * patch into ONE atomic PATCH that also writes the new modelId. The
 * predecessor effect-driven design (e.g. `useReasoningEffortSync`,
 * `Inputbar`'s `enableWebSearch` reset) watched SWR data and emitted a
 * second PATCH out-of-band — every SWR revalidate re-fired the effect,
 * making no-op PATCHes routine and validation failures self-sustaining.
 *
 * Returning `null` from a reconcile fn means "current value is fine, no
 * patch needed". Callers compose multiple reconcile fns and only emit a
 * settings patch when at least one returned non-null.
 */
import {
  getThinkModelType,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  isWebSearchModel,
  MODEL_SUPPORTED_OPTIONS,
  MODEL_SUPPORTED_REASONING_EFFORT
} from '@renderer/config/models'
import { cacheService } from '@renderer/data/CacheService'
import type { AssistantSettings, Model as V1Model, ThinkingOption } from '@renderer/types'

export type ReasoningEffortPatch = {
  reasoning_effort?: string
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
      reasoning_effort: fallback === 'none' ? undefined : fallback
    }
  }

  // Switched to a non-thinking model: stash the current choice and clear.
  if (currentEffort === undefined) return null
  cacheService.set(cacheKey, currentEffort)
  return {
    reasoning_effort: undefined
  }
}

export function reconcileWebSearchForModel(
  nextModel: V1Model,
  current: Pick<AssistantSettings, 'enableWebSearch'>
): { enableWebSearch: false } | null {
  if (!current.enableWebSearch) return null
  if (isWebSearchModel(nextModel)) return null
  return { enableWebSearch: false }
}
