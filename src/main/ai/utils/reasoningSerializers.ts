/**
 * Pure reasoning profile interpreter.
 *
 * Model/provider identification happens while resolving the registry profile.
 * This module only consumes the resulting closed profile plus the canonical
 * user selection, then emits a closed list of target/value operations.
 */
import type {
  ReasoningEffort,
  ReasoningWireMode,
  ReasoningWireProfile,
  ReasoningWireTarget
} from '@cherrystudio/provider-registry'
import { DEFAULT_MAX_TOKENS } from '@main/ai/constants'
import { nearestThinkingOption, resolveBudgetTokens } from '@shared/ai/reasoning'
import type { Model } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

export type CanonicalReasoningSelection = ReasoningEffortOption

export type ResolvedReasoningKind = 'omit' | 'off' | 'auto' | 'effort' | 'budget'

export interface ResolvedReasoningEmission {
  target: ReasoningWireTarget
  value: string | number | boolean
}

export interface ResolvedReasoningInvocation {
  kind: ResolvedReasoningKind
  selection: CanonicalReasoningSelection
  effort?: ReasoningEffort
  budgetTokens?: number
  emissions: ResolvedReasoningEmission[]
}

export interface ResolveReasoningInvocationInput {
  selection: CanonicalReasoningSelection | undefined
  model: Model
  profile: ReasoningWireProfile
  maxTokens?: number
  assistantSummary?: string | null
}

const OMIT: ResolvedReasoningInvocation = {
  kind: 'omit',
  selection: 'default',
  emissions: []
}

function resolveSelection(
  selection: ResolveReasoningInvocationInput['selection'],
  model: Model
): CanonicalReasoningSelection | undefined {
  if (!selection || selection === 'default') return 'default'
  const selectable = model.reasoning?.selectableEfforts ?? []
  if (selection === 'none' || selection === 'auto') {
    return selectable.includes(selection) ? selection : undefined
  }

  const declared = selectable.filter(
    (effort): effort is Exclude<ReasoningEffort, 'none' | 'auto'> => effort !== 'none' && effort !== 'auto'
  )
  if (declared.length === 0) return undefined

  return nearestThinkingOption(selection, declared)
}

function resolveMode(
  selection: CanonicalReasoningSelection,
  profile: ReasoningWireProfile
): ReasoningWireMode | undefined {
  if (profile.disabled) return undefined
  if (selection === 'default') return profile.default
  if (selection === 'none') return profile.off
  if (selection === 'auto') return profile.auto ?? profile.effort
  return profile.effort
}

function resolveModeEffort(
  selection: CanonicalReasoningSelection,
  mode: ReasoningWireMode
): ReasoningEffort | undefined {
  if (selection === 'default' || selection === 'none') return undefined
  return mode.effortMap?.[selection] ?? selection
}

function resolveModeBudget(
  selection: CanonicalReasoningSelection,
  model: Model,
  policy: Extract<ReasoningWireMode, { budget: unknown }>['budget'],
  maxTokens: number | undefined
): number | undefined {
  let budget = selection === 'auto' ? policy.autoValue : undefined
  budget ??= resolveBudgetTokens(selection, model.reasoning)

  if (budget === undefined && policy.missing.type === 'fallback') {
    budget = policy.missing.value
  }
  if (budget === undefined) return undefined

  if (policy.min !== undefined) {
    budget = Math.max(policy.min, budget)
  }

  if (policy.clampToMaxTokens) {
    budget = Math.min(Math.max(policy.min ?? 1024, budget), maxTokens ?? DEFAULT_MAX_TOKENS)
  }

  return Math.floor(budget)
}

export function resolveReasoningInvocation(input: ResolveReasoningInvocationInput): ResolvedReasoningInvocation {
  if (!input.model.reasoning || input.profile.disabled) return OMIT

  const selection = resolveSelection(input.selection, input.model)
  if (!selection) return OMIT

  const mode = resolveMode(selection, input.profile)
  if (!mode) return { ...OMIT, selection }

  const effort = resolveModeEffort(selection, mode)
  const budgetTokens =
    'budget' in mode ? resolveModeBudget(selection, input.model, mode.budget, input.maxTokens) : undefined

  if ('budget' in mode && mode.budget.missing.type === 'omit-mode' && budgetTokens === undefined) {
    return { ...OMIT, selection }
  }

  const emissions: ResolvedReasoningEmission[] = []
  for (const operation of mode.operations) {
    let value: string | number | boolean | undefined
    switch (operation.value.source) {
      case 'literal':
        value = operation.value.value
        break
      case 'effort':
        value = effort
        break
      case 'budget':
        value = budgetTokens
        break
      case 'assistant-summary':
        value = input.assistantSummary ?? undefined
        break
    }
    if (value !== undefined) emissions.push({ target: operation.target, value })
  }

  if (emissions.length === 0) return { ...OMIT, selection }

  const kind: ResolvedReasoningKind =
    budgetTokens !== undefined ? 'budget' : selection === 'none' ? 'off' : selection === 'auto' ? 'auto' : 'effort'

  return {
    kind,
    selection,
    effort,
    budgetTokens,
    emissions
  }
}

function encodeEmissions(invocation: ResolvedReasoningInvocation): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const emission of invocation.emissions) {
    const path = emission.target.split('.')
    let cursor = result
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = path[index]
      cursor[key] ??= {}
      cursor = cursor[key] as Record<string, unknown>
    }
    cursor[path[path.length - 1]] = emission.value
  }

  return result
}

/** Materialize the profile's closed emission operations into a provider-options object. */
export function encodeReasoningInvocation(invocation: ResolvedReasoningInvocation): Record<string, unknown> {
  return encodeEmissions(invocation)
}
