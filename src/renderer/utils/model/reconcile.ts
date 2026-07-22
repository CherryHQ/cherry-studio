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
import { cacheService } from '@renderer/data/CacheService'
import type { AssistantSettings } from '@renderer/types/assistant'
import type { ThinkingOption } from '@renderer/types/reasoning'
import { deriveThinkingOptions, nearestThinkingOption } from '@shared/ai/reasoning'
import type { Model } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { isFunctionCallingModel } from './tooluse'
import { isOpenRouterBuiltInWebSearchModel, isWebSearchModel } from './websearch'

export type ReasoningEffortPatch = {
  reasoning_effort?: ReasoningEffortOption
}

export function hasModelBuiltinWebSearch(model: Model): boolean {
  return isWebSearchModel(model) || isOpenRouterBuiltInWebSearchModel(model)
}

export function canModelUseAssistantWebSearch(model: Model): boolean {
  return hasModelBuiltinWebSearch(model) || isFunctionCallingModel(model)
}

export function reconcileReasoningEffortForModel(
  nextModel: Model,
  currentEffort: ReasoningEffortOption | undefined,
  assistantId: string
): ReasoningEffortPatch | null {
  const cacheKey = `assistant.reasoning_effort_cache.${assistantId}` as const

  // Descriptor-driven vocabulary (#16598) — the same derivation the
  // ThinkingButton renders, so reconcile can never park an option the UI
  // doesn't offer.
  const supportedOptions = deriveThinkingOptions(nextModel)
  if (supportedOptions && supportedOptions.some((option) => option !== 'default')) {
    if (currentEffort && supportedOptions.includes(currentEffort)) {
      return null // current value already supported — no PATCH needed
    }
    const cached = cacheService.get(cacheKey) as ThinkingOption | undefined
    const fallback: ThinkingOption =
      cached && supportedOptions.includes(cached)
        ? cached
        : currentEffort !== undefined
          ? // Out-of-vocabulary persisted value: nearest native tier along the
            // intensity ladder (xhigh↔max aliasing, minimal→low, …).
            (nearestThinkingOption(currentEffort, supportedOptions) ?? supportedOptions[0])
          : supportedOptions[0]
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
  nextModel: Model,
  current: Pick<AssistantSettings, 'enableWebSearch'>
): { enableWebSearch: false } | null {
  if (!current.enableWebSearch) return null
  if (canModelUseAssistantWebSearch(nextModel)) return null
  return { enableWebSearch: false }
}
