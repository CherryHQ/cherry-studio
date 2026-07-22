/** Provider-neutral reasoning vocabulary and budget policy shared by Main and Renderer. */
import { REASONING_EFFORT_ORDER } from '@cherrystudio/provider-registry'
import type { Model, RuntimeReasoning } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { isReasoningModel } from '@shared/utils/model'

type BudgetEffort = Exclude<ReasoningEffortOption, 'default' | 'none' | 'auto'>

const EFFORT_RATIO: Record<BudgetEffort, number> = {
  minimal: 0.05,
  low: 0.05,
  medium: 0.5,
  high: 0.8,
  xhigh: 0.9,
  max: 1
}

const BUDGET_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const EFFORT_ORDER_INDEX = new Map(REASONING_EFFORT_ORDER.map((effort, index) => [effort, index]))

export function deriveThinkingOptions(model: Model): ReasoningEffortOption[] | undefined {
  if (!isReasoningModel(model)) return undefined
  const vocabulary = model.reasoning?.selectableEfforts
  if (!vocabulary?.length) return undefined

  const rest = vocabulary.filter((effort) => effort !== 'none')
  return ['default', ...(vocabulary.includes('none') ? (['none'] as const) : []), ...rest]
}

/** Resolve a persisted selection to the nearest effort exposed by the next model. */
export function nearestThinkingOption(
  target: ReasoningEffortOption,
  options: readonly ReasoningEffortOption[]
): ReasoningEffortOption | undefined {
  const selectable = options.filter((option): option is ReasoningEffortOption => option !== 'default')
  if (selectable.includes(target)) return target

  const targetIndex = EFFORT_ORDER_INDEX.get(target)
  if (targetIndex === undefined) return selectable[0]

  let best: ReasoningEffortOption | undefined
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (const option of selectable) {
    const index = EFFORT_ORDER_INDEX.get(option)
    if (index === undefined) continue
    const distance = Math.abs(index - targetIndex)
    if (distance < bestDistance || (distance === bestDistance && index > bestIndex)) {
      best = option
      bestIndex = index
      bestDistance = distance
    }
  }
  return best ?? selectable[0]
}

export function computeBudgetTokens(
  tokenLimit: { min: number; max: number },
  effortRatio: number,
  maxTokens?: number
): number {
  const budget = Math.max(1024, Math.floor((tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min))
  return maxTokens === undefined ? budget : Math.min(budget, maxTokens)
}

function resolveBudgetEffort(
  selection: ReasoningEffortOption,
  reasoning: RuntimeReasoning | undefined
): BudgetEffort | undefined {
  if (selection === 'default' || selection === 'none') return undefined
  const effort = selection === 'auto' ? (reasoning?.defaultEffort ?? 'high') : selection
  if (effort === 'none' || effort === 'auto') return effort === 'auto' ? 'high' : undefined
  return effort
}

/** Resolve a selection against descriptor-declared token limits. */
export function resolveBudgetTokens(
  selection: ReasoningEffortOption,
  reasoning: RuntimeReasoning | undefined,
  maxTokens?: number
): number | undefined {
  const limits = reasoning?.thinkingTokenLimits
  const effort = resolveBudgetEffort(selection, reasoning)
  if (limits?.min == null || limits.max == null || effort === undefined) return undefined
  return computeBudgetTokens({ min: limits.min, max: limits.max }, EFFORT_RATIO[effort], maxTokens)
}

/** Reverse a fixed thinking budget to the closest shared effort tier. */
export function nearestEffortForBudget(
  budget: number,
  tokenLimit: { min?: number; max?: number } | undefined
): ReasoningEffortOption | undefined {
  if (!Number.isFinite(budget) || tokenLimit?.min == null || tokenLimit.max == null) return undefined

  const limits = { min: tokenLimit.min, max: tokenLimit.max }
  let nearest: (typeof BUDGET_EFFORTS)[number] = BUDGET_EFFORTS[0]
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const effort of BUDGET_EFFORTS) {
    const distance = Math.abs(budget - computeBudgetTokens(limits, EFFORT_RATIO[effort]))
    if (distance <= nearestDistance) {
      nearest = effort
      nearestDistance = distance
    }
  }

  return nearest
}

export function getThinkingBudget(
  maxTokens: number | undefined,
  selection: ReasoningEffortOption | undefined,
  reasoning: RuntimeReasoning | undefined
): number | undefined {
  return selection === undefined ? undefined : resolveBudgetTokens(selection, reasoning, maxTokens)
}
