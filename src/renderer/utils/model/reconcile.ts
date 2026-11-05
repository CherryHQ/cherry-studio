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
import { resolveReasoningEffortForModel } from '@shared/ai/reasoning'
import type { ChatModelSetting } from '@shared/data/preference/preferenceTypes'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { isBuiltinWebSearchAvailable, isBuiltinWebSearchEffortUnsupported } from '@shared/utils/provider'

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
  currentEffort: ReasoningEffortOption | undefined
): ReasoningEffortPatch | null {
  const nextEffort = resolveReasoningEffortForModel(nextModel, currentEffort)
  if (nextEffort === currentEffort) return null
  return { reasoning_effort: nextEffort }
}

export function reconcileWebSearchForModel(
  nextModel: Model,
  current: Pick<AssistantSettings, 'enableWebSearch' | 'reasoning_effort'>,
  provider: Provider | undefined
): { enableWebSearch: false } | null {
  if (!current.enableWebSearch) return null
  if (!canModelUseAssistantWebSearch(nextModel, provider)) return { enableWebSearch: false }
  // `resolveWebToolRoutes` withdraws the builtin search route for efforts the
  // provider's search rejects (reason 'openai-minimal-reasoning'), and the
  // composer refuses to create that pair in either direction. Reconciliation
  // must not restore it either: keep the effort, drop the search flag so the
  // control never stays active without a route.
  if (isBuiltinWebSearchEffortUnsupported(nextModel, provider, current.reasoning_effort)) {
    return { enableWebSearch: false }
  }
  return null
}

/**
 * The single model-switch settings operation shared by every model-change
 * entry point (composer `useAssistant.setModel`, assistant edit dialog).
 *
 * Restores the target model's remembered web search / reasoning effort,
 * reconciles the restored pair against the target model, and returns the
 * settings patch to merge into ONE atomic write that also carries the new
 * `modelId`. Returns `undefined` when nothing needs writing (same model and
 * nothing restored or reconciled).
 *
 * Remembered choices are only read here, never overwritten: when the
 * restored pair is incompatible (e.g. builtin search + 'minimal' on OpenAI
 * GPT-5), the applied patch drops the search flag while the saved per-model
 * preferences stay untouched.
 */
export function resolveModelSwitchSettings(args: {
  next: Model
  nextProvider: Provider | undefined
  currentModelId: string | null | undefined
  currentSettings: Partial<AssistantSettings> | undefined
  remembered: ChatModelSetting | undefined
  extraSettings?: Partial<AssistantSettings>
}): Partial<AssistantSettings> | undefined {
  const { next, nextProvider, currentModelId, currentSettings, remembered, extraSettings } = args
  // Restore the target model's remembered choices; fall back to web search
  // off and the model default effort.
  const restored: Partial<AssistantSettings> =
    next.id === currentModelId
      ? {}
      : { enableWebSearch: remembered?.enableWebSearch ?? false, reasoning_effort: remembered?.reasoning_effort }
  const baseSettings = { ...currentSettings, ...restored }
  const reasoning = reconcileReasoningEffortForModel(next, baseSettings.reasoning_effort)
  // Evaluate the search pair against the effort that will actually apply.
  const effectiveEffort = reasoning ? reasoning.reasoning_effort : baseSettings.reasoning_effort
  const webSearch = reconcileWebSearchForModel(
    next,
    { enableWebSearch: baseSettings.enableWebSearch, reasoning_effort: effectiveEffort },
    nextProvider
  )
  return extraSettings || reasoning || webSearch || next.id !== currentModelId
    ? { ...baseSettings, ...reasoning, ...webSearch, ...extraSettings }
    : undefined
}
