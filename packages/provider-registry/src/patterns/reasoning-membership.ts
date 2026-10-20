/**
 * Zero-knowledge matcher for reasoning MEMBERSHIP — "is this id a reasoning
 * model at all?" (#16598). This is the ingest gate consulted BEFORE the knob
 * parts of the same rule table supply the knobs (`reasoning-families.ts`).
 *
 * Membership is implied by the family rule table itself: any id matched by a
 * PROFILE rule (one without `template: true`) is a reasoning SKU. TEMPLATE
 * rules are deliberately broad knob-shape carriers (e.g. the `^qwen` toggle)
 * and contribute nothing here — that separation is what lets a broad rule
 * exist without over-claiming non-reasoning siblings.
 *
 * Vendor knowledge lives as DATA in `Creator.reasoningFamilies`
 * (creators/*.ts), compiled by generation into `reasoning-families.gen.ts`.
 * This module only knows how to MATCH, plus the creator-AGNOSTIC id shapes
 * below (generic words like "thinking" are not family knowledge).
 *
 * Consumed at INGEST time only — runtime callers read the model's REASONING
 * capability / descriptor instead.
 */
import type { ReasoningFamilyRule } from '../schemas/model'

/**
 * Creator-agnostic id shapes that mark a reasoning model regardless of
 * vendor: generic reasoning words, DeepSeek-R1-style `-rN` revisions.
 * `pangu-pro-moe` is an unattributed residue — Huawei has no creator entry
 * to carry it; move it there if one ever exists.
 */
const GENERIC_REASONING_SHAPES: readonly string[] = [
  '\\b(?:reasoning|reasoner|thinking|think)\\b',
  '-r\\d+',
  'pangu-pro-moe'
]

/** Explicit non-reasoning marker — vetoes every pattern (generic and creator). */
const NON_REASONING_GUARD = /-non-reasoning\b/i

const regexCache = new Map<string, RegExp>()
function membershipRegex(pattern: string): RegExp {
  let regex = regexCache.get(pattern)
  if (!regex) {
    regex = new RegExp(pattern, 'i')
    regexCache.set(pattern, regex)
  }
  return regex
}

/**
 * Normalize a raw id the way the legacy gate did (`getLowerBaseModelName`):
 * lowercase, Fireworks `1p5` → `1.5`, strip the namespace prefix and the
 * `:free` / `(free)` / `:cloud` listing suffixes.
 */
function membershipBaseName(rawModelId: string): string {
  const normalized = rawModelId.toLowerCase().startsWith('accounts/fireworks/models/')
    ? rawModelId.replace(/(\d)p(?=\d)/g, '$1.')
    : rawModelId
  const lower = normalized.toLowerCase()
  let base = lower.slice(lower.lastIndexOf('/') + 1)
  if (base.endsWith(':free')) base = base.slice(0, -':free'.length)
  if (base.endsWith('(free)')) base = base.slice(0, -'(free)'.length)
  if (base.endsWith(':cloud')) base = base.slice(0, -':cloud'.length)
  return base
}

/** Test an id against the rule table: profile rules + generic shapes grant membership. */
export function matchReasoningMembership(rawModelId: string, rules: readonly ReasoningFamilyRule[]): boolean {
  const id = membershipBaseName(rawModelId)
  if (NON_REASONING_GUARD.test(id)) return false
  return (
    rules.some((rule) => rule.template !== true && membershipRegex(rule.pattern).test(id)) ||
    GENERIC_REASONING_SHAPES.some((pattern) => membershipRegex(pattern).test(id))
  )
}
