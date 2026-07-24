/**
 * Derive the legacy reasoning fields (`supportedEfforts` / `thinkingTokenLimits`
 * / `defaultEffort`) from a model's `controls` declaration — the SINGLE place
 * the controls→legacy mapping lives.
 *
 * Called at generation time (`buildModels` normalization pass) so the shipped
 * models.json always has controls and derived fields in lockstep, and by the
 * catalog invariant test to lock that consistency. Runtime consumers keep
 * reading the derived fields; `controls` travels alongside for consumers that
 * need the full declaration (budget UI, always-on detection).
 */
import type { ReasoningControl, ReasoningSupport } from '../schemas/model'

export type DerivedReasoningFields = Pick<
  ReasoningSupport,
  'supportedEfforts' | 'thinkingTokenLimits' | 'defaultEffort'
>

export function deriveLegacyReasoningFields(controls: readonly ReasoningControl[]): DerivedReasoningFields {
  const effort = controls.find((c) => c.kind === 'effort')
  const budget = controls.find((c) => c.kind === 'budget')
  const toggle = controls.find((c) => c.kind === 'toggle')

  // Vocabulary: the effort control's native values; a bare toggle maps to
  // ['none','auto'] (off/on — mirrors the models.dev ingest rule). A toggle
  // NEXT TO an effort control only contributes 'none' (the off switch) —
  // APPENDED, because legacy consumers treat index 0 as the coercion fallback
  // and must not fall back to "off"; the UI orders the off switch itself.
  let supportedEfforts = effort ? [...effort.values] : toggle ? (['none', 'auto'] as const).slice() : undefined
  if (effort && toggle && supportedEfforts && !supportedEfforts.includes('none')) {
    supportedEfforts = [...supportedEfforts, 'none']
  }

  return {
    supportedEfforts,
    thinkingTokenLimits: budget
      ? { min: budget.min, max: budget.max, ...(budget.default != null ? { default: budget.default } : {}) }
      : undefined,
    defaultEffort: effort?.default
  }
}
