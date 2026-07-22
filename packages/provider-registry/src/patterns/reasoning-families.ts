/**
 * Zero-knowledge matcher for creator-declared reasoning family rules
 * (#16598). ALL family knowledge lives in `Creator.reasoningFamilies` data
 * declarations (creators/*.ts) — compiled by generation into
 * `reasoning-families.gen.ts`; this module only knows how to MATCH.
 *
 * Two independent match parts, composed into a `controls` declaration
 * (mirrors the legacy two-table semantics exactly):
 *  - VOCABULARY part — the first rule declaring `effort` and/or `toggle`
 *    whose pattern matches the lowercased, namespace-stripped id.
 *    `toggle: false` is an explicit "always-on, no switch" declaration that
 *    wins the part while contributing no control.
 *  - BUDGET part — the first rule declaring `budget` whose pattern matches.
 *    `matchTokenLimits` tests the raw catalog id during generation; budget
 *    patterns stay unanchored so namespaced ids remain matchable.
 *
 * This module is import-safe for the generation script (no dependency on
 * the generated artifact); the bound convenience API lives in
 * `reasoning-heuristics.ts`.
 */
import type { ReasoningControl, ReasoningFamilyRule } from '../schemas/model'

/** Lowercase and strip a namespace prefix (`deepseek/deepseek-r1` → `deepseek-r1`). */
function baseName(rawModelId: string): string {
  const lower = rawModelId.toLowerCase()
  return lower.slice(lower.lastIndexOf('/') + 1)
}

const regexCache = new Map<string, RegExp>()
function ruleRegex(pattern: string): RegExp {
  let regex = regexCache.get(pattern)
  if (!regex) {
    regex = new RegExp(pattern, 'i')
    regexCache.set(pattern, regex)
  }
  return regex
}

/**
 * Infer a model's reasoning controls from its id against a rule list.
 * Returns `undefined` when nothing matches — callers gate on the model
 * actually being reasoning-capable; rules only know the KNOBS.
 */
export function matchReasoningControls(
  rawModelId: string,
  rules: readonly ReasoningFamilyRule[]
): ReasoningControl[] | undefined {
  const id = baseName(rawModelId)
  let vocabularyRule: ReasoningFamilyRule | undefined
  let budgetRule: ReasoningFamilyRule | undefined
  for (const rule of rules) {
    const declaresVocabulary = rule.effort !== undefined || rule.toggle !== undefined
    if (!vocabularyRule && declaresVocabulary && ruleRegex(rule.pattern).test(id)) {
      vocabularyRule = rule
    }
    if (!budgetRule && rule.budget && ruleRegex(rule.pattern).test(id)) {
      budgetRule = rule
    }
    if (vocabularyRule && budgetRule) break
  }

  const controls: ReasoningControl[] = []
  if (vocabularyRule?.effort) controls.push({ kind: 'effort', values: [...vocabularyRule.effort] })
  if (budgetRule?.budget) controls.push({ kind: 'budget', min: budgetRule.budget.min, max: budgetRule.budget.max })
  if (vocabularyRule?.toggle) controls.push({ kind: 'toggle' })
  return controls.length ? controls : undefined
}

/** Return the first matching vocabulary rule's explicit toggle policy. */
export function matchReasoningTogglePolicy(
  rawModelId: string,
  rules: readonly ReasoningFamilyRule[]
): boolean | undefined {
  const id = baseName(rawModelId)
  for (const rule of rules) {
    if ((rule.effort !== undefined || rule.toggle !== undefined) && ruleRegex(rule.pattern).test(id)) {
      return rule.toggle
    }
  }
  return undefined
}

/**
 * Thinking-token limits for a raw catalog id. Tests the raw string so
 * unanchored patterns also match namespaced ids.
 */
export function matchTokenLimits(
  rawModelId: string,
  rules: readonly ReasoningFamilyRule[]
): { min: number; max: number } | undefined {
  for (const rule of rules) {
    if (rule.budget && ruleRegex(rule.pattern).test(rawModelId)) {
      return { min: rule.budget.min, max: rule.budget.max }
    }
  }
  return undefined
}
