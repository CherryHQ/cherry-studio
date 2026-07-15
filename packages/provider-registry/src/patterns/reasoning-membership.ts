/**
 * Zero-knowledge matcher for reasoning MEMBERSHIP — "is this id a reasoning
 * model at all?" (#16598). This is the ingest gate consulted BEFORE the knob
 * rules (`reasoning-families.ts`): family rules only say which knobs a
 * reasoning SKU has, and some (e.g. the broad `^qwen` toggle) rely on this
 * gate to not over-claim non-reasoning siblings.
 *
 * Vendor knowledge lives as DATA in `Creator.reasoningMembership`
 * (creators/*.ts), compiled by generation into
 * `reasoning-membership.gen.ts`. This module only knows how to MATCH, plus
 * the creator-AGNOSTIC id shapes below (generic words like "thinking" are
 * not family knowledge).
 *
 * Consumed at INGEST time only — runtime callers read the model's REASONING
 * capability / descriptor instead.
 */

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

/** Test an id against a membership pattern list (creator rules + generic shapes). */
export function matchReasoningMembership(rawModelId: string, patterns: readonly string[]): boolean {
  const id = membershipBaseName(rawModelId)
  if (NON_REASONING_GUARD.test(id)) return false
  return (
    patterns.some((pattern) => membershipRegex(pattern).test(id)) ||
    GENERIC_REASONING_SHAPES.some((pattern) => membershipRegex(pattern).test(id))
  )
}
