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
import type { AssistantSettings } from '@renderer/types/assistant'
import { deriveThinkingOptions, nearestThinkingOption } from '@shared/ai/reasoning'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { isBuiltinWebSearchAvailable } from '@shared/utils/provider'

import { isFunctionCallingModel } from './tooluse'

export type ReasoningEffortPatch = {
  reasoning_effort?: ReasoningEffortOption
}

/** Project a current selection onto the next model's renderer vocabulary. */
export function resolveReasoningEffortForModel(
  nextModel: Model,
  currentEffort: ReasoningEffortOption | undefined
): ReasoningEffortOption | undefined {
  const supportedOptions = deriveThinkingOptions(nextModel)
  if (!supportedOptions?.some((option) => option !== 'default')) return undefined
  if (currentEffort && supportedOptions.includes(currentEffort)) return currentEffort
  if (currentEffort !== undefined) return nearestThinkingOption(currentEffort, supportedOptions) ?? supportedOptions[0]
  return supportedOptions[0]
}

export function hasModelBuiltinWebSearch(model: Model, provider: Provider | undefined): boolean {
  return !!provider && isBuiltinWebSearchAvailable(model, provider)
}

export function canModelUseAssistantWebSearch(model: Model, provider: Provider | undefined): boolean {
  return hasModelBuiltinWebSearch(model, provider) || isFunctionCallingModel(model)
}

export function reconcileReasoningEffortForModel(
  nextModel: Model,
  currentEffort: ReasoningEffortOption | undefined
): ReasoningEffortPatch | null {
  const nextEffort = resolveReasoningEffortForModel(nextModel, currentEffort)
  if (nextEffort === currentEffort) return null
  return { reasoning_effort: nextEffort }
}

export function reconcileWebSearchForModel(
  nextModel: Model,
  current: Pick<AssistantSettings, 'enableWebSearch'>,
  provider: Provider | undefined
): { enableWebSearch: false } | null {
  if (!current.enableWebSearch) return null
  if (canModelUseAssistantWebSearch(nextModel, provider)) return null
  return { enableWebSearch: false }
}
