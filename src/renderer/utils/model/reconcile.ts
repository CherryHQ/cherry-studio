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
import { deriveThinkingOptions, resolveReasoningEffortForModel } from '@shared/ai/reasoning'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { isBuiltinWebSearchAvailable } from '@shared/utils/provider'

import { isFunctionCallingModel } from './tooluse'

export type ReasoningEffortPatch = {
  reasoning_effort?: ReasoningEffortOption
}

export { resolveReasoningEffortForModel }

export function hasModelBuiltinWebSearch(model: Model, provider: Provider | undefined): boolean {
  return !!provider && isBuiltinWebSearchAvailable(model, provider)
}

export function canModelUseAssistantWebSearch(model: Model, provider: Provider | undefined): boolean {
  return hasModelBuiltinWebSearch(model, provider) || isFunctionCallingModel(model)
}

export function reconcileReasoningEffortForModel(
  nextModel: Model,
  currentEffort: ReasoningEffortOption | undefined,
  assistantId?: string,
  reasoningEffortByModel?: Record<string, string>
): ReasoningEffortPatch | null {
  // Per-model preference: restore the user's last choice for this exact model id if available.
  // Preserves the intent of d841980947 while adapting to the descriptor-driven vocabulary
  // introduced in main (deriveThinkingOptions / resolveReasoningEffortForModel).
  if (assistantId !== undefined && reasoningEffortByModel) {
    const pref = reasoningEffortByModel[nextModel.id]
    if (pref !== undefined) {
      const prefOption = pref as ReasoningEffortOption
      const supported = deriveThinkingOptions(nextModel)
      // If the model declares a vocabulary, only restore the pref when it's natively supported.
      // Fixed / non-reasoning models have supported === undefined and fall through to the
      // standard clearing logic below.
      if (supported?.includes(prefOption)) {
        if (currentEffort !== prefOption) {
          return { reasoning_effort: prefOption }
        }
        return null
      }
      // Handle legacy 'none' -> undefined normalization for older stored values:
      // if pref is 'none' and current is undefined, consider them equivalent when the vocab
      // does not contain 'none' (treated as cleared).
      if (pref === 'none' && currentEffort === undefined && !supported?.includes('none' as ReasoningEffortOption)) {
        return null
      }
    }
  }

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
