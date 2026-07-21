/**
 * Effort-plan resolution shared by the reasoning serializers (#16598).
 *
 * Turns the persisted `assistant.settings.reasoning_effort` string plus the
 * model's registry descriptor into a validated plan:
 *  - `omit`  — send no reasoning params ('default' / unset)
 *  - `off`   — explicitly disable ('none')
 *  - `effort`— a vocabulary-validated effort + the descriptor-derived budget
 *
 * Vocabulary coercion intentionally mirrors the legacy injector: an
 * out-of-vocabulary effort falls back to the FIRST option (frozen by the
 * golden matrix). The nearest-match ladder (`REASONING_EFFORT_ORDER`) is a
 * UI/reconcile concern, not the injector's.
 */
import type { RuntimeReasoning } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { EFFORT_RATIO } from '../utils/reasoning'
import { computeBudgetTokens } from './reasoningBudget'

export type EffortPlan =
  | { kind: 'omit' }
  | { kind: 'off' }
  | { kind: 'effort'; effort: Exclude<ReasoningEffortOption, 'none' | 'default'> }

export function resolveEffortPlan(setting: string | undefined): EffortPlan {
  if (!setting || setting === 'default') return { kind: 'omit' }
  if (setting === 'none') return { kind: 'off' }
  return { kind: 'effort', effort: setting as Exclude<ReasoningEffortOption, 'none' | 'default'> }
}

/**
 * The thinking-token budget for an effort: `floor((max-min) * ratio + min)`,
 * with limits read from `model.reasoning.thinkingTokenLimits`. Returns
 * `undefined` when the descriptor declares no limits — callers decide their
 * own wire-specific fallback.
 */
export function resolveBudgetTokens(effort: string, reasoning: RuntimeReasoning | undefined): number | undefined {
  const limits = reasoning?.thinkingTokenLimits
  if (limits?.min == null || limits.max == null) return undefined
  const ratio = EFFORT_RATIO[effort as keyof typeof EFFORT_RATIO]
  if (ratio == null) return undefined
  return computeBudgetTokens({ min: limits.min, max: limits.max }, ratio)
}
