/**
 * Descriptor-driven reasoning-effort vocabulary (#16598) — the ONE derivation
 * both the composer UI (ThinkingButton / reconcile / model detail card) and
 * any other options surface read, replacing the renderer's 37-family
 * `getThinkModelType` + `MODEL_SUPPORTED_OPTIONS` regex tables.
 *
 * Presentation rules, keyed on the model's `controls` declaration:
 *  - effort control → its NATIVE values, in declared order (what the API
 *    accepts is what the user sees);
 *  - budget(+toggle) → the preset ladder low/medium/high over the budget
 *    range ('none' first when the toggle exists), which the serializers map
 *    through EFFORT_RATIO × thinkingTokenLimits;
 *  - toggle only → on/off ('none'/'auto');
 *  - no knobs (fixed reasoning, or a 'none'-format provider) → `undefined`,
 *    the control renders disabled.
 * `'default'` (send nothing) is a UI sentinel synthesized here, always first;
 * `'none'` is hoisted right after it.
 */
import { REASONING_EFFORT_ORDER } from '@cherrystudio/provider-registry'
import type { Model } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { isReasoningModel } from '@shared/utils/model'

export function deriveThinkingOptions(model: Model): ReasoningEffortOption[] | undefined {
  if (!isReasoningModel(model)) return undefined
  const reasoning = model.reasoning
  if (!reasoning) return undefined // fixed reasoning — no knob

  const hasControls = (reasoning.controls?.length ?? 0) > 0
  const hasEffort = reasoning.controls?.some((c) => c.kind === 'effort') ?? false
  const hasToggle = reasoning.controls?.some((c) => c.kind === 'toggle') ?? false
  const hasBudget = reasoning.thinkingTokenLimits != null

  let vocabulary: ReasoningEffortOption[]
  if (hasEffort || (!hasControls && reasoning.supportedEfforts.length > 0)) {
    vocabulary = [...reasoning.supportedEfforts]
  } else if (hasBudget) {
    vocabulary = hasToggle ? ['none', 'low', 'medium', 'high'] : ['low', 'medium', 'high']
  } else if (hasToggle) {
    vocabulary = ['none', 'auto']
  } else {
    return undefined
  }
  if (vocabulary.length === 0) return undefined // e.g. a 'none'-format provider

  const rest = vocabulary.filter((v) => v !== 'none')
  return ['default', ...(vocabulary.includes('none') ? (['none'] as const) : []), ...rest]
}

/**
 * Nearest vocabulary option to a persisted effort, along the
 * `REASONING_EFFORT_ORDER` intensity ladder (ties break UPWARD so a
 * mid-ladder value never silently weakens). Used by reconcile-on-model-switch;
 * the injector never coerces — the UI guarantees in-vocabulary values.
 */
export function nearestThinkingOption(
  target: string,
  options: readonly ReasoningEffortOption[]
): ReasoningEffortOption | undefined {
  const ladder = REASONING_EFFORT_ORDER as readonly string[]
  // Explicit predicate: keep the element type wide (TS would otherwise infer
  // Exclude<…,'default'> and reject the includes() probe below).
  const selectable = options.filter((o): o is ReasoningEffortOption => o !== 'default')
  if (selectable.includes(target as ReasoningEffortOption)) return target as ReasoningEffortOption
  const targetIndex = ladder.indexOf(target)
  if (targetIndex === -1) return selectable[0]
  let best: ReasoningEffortOption | undefined
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (const option of selectable) {
    const index = ladder.indexOf(option)
    if (index === -1) continue
    const distance = Math.abs(index - targetIndex)
    if (distance < bestDistance || (distance === bestDistance && index > bestIndex)) {
      best = option
      bestIndex = index
      bestDistance = distance
    }
  }
  return best ?? selectable[0]
}
