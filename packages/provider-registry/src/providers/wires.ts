/**
 * Builder for the reasoning wire shape most providers use: ONE target, one operation per mode.
 *
 * The literal form is deliberately verbose — five lines to say "write `thinking.type` per mode" — and it
 * repeats across ~20 providers. `modeWire` states the same thing on one line while keeping the wire
 * legible against a vendor's docs, which is what these definitions get reviewed for. Anything richer
 * (several operations per mode, budget policies) stays a plain object literal; this builder is only for
 * the simple majority and intentionally cannot express those.
 */
import type { ReasoningEffort } from '../schemas/enums'
import type { ReasoningWireProfile, ReasoningWireTarget, ReasoningWireValue } from '../schemas/reasoningWire'

/** Emit the user's selected effort instead of a fixed literal (`{ source: 'effort' }`). */
export const EFFORT = { source: 'effort' } as const

type ModeValue = string | number | boolean | typeof EFFORT

/** The wire modes a profile can declare, minus `disabled` (which carries no operations). */
type ModeKey = 'default' | 'off' | 'auto' | 'effort'

export interface ModeWireOptions {
  /**
   * Narrow the canonical `auto` selection onto a concrete vendor tier, e.g. `'medium'`. Applied to the
   * `auto` mode only, matching how providers publish a default thinking level.
   */
  autoEffort?: ReasoningEffort
}

/**
 * @param target the single wire field every mode writes
 * @param modes value per mode — a plain value becomes a literal, `EFFORT` passes the selection through
 */
export function modeWire(
  target: ReasoningWireTarget,
  modes: Partial<Record<ModeKey, ModeValue>>,
  options: ModeWireOptions = {}
): ReasoningWireProfile {
  const profile: Partial<Record<ModeKey, ReasoningWireProfile[ModeKey]>> = {}

  // Object key order is preserved, so a call site's mode order survives into the emitted profile.
  for (const [key, value] of Object.entries(modes) as [ModeKey, ModeValue | undefined][]) {
    if (value === undefined) continue
    const wireValue: ReasoningWireValue =
      value === EFFORT ? { source: 'effort' } : { source: 'literal', value: value as string | number | boolean }
    const operations = [{ target, value: wireValue }]
    profile[key] =
      key === 'auto' && options.autoEffort ? { operations, effortMap: { auto: options.autoEffort } } : { operations }
  }

  return profile as ReasoningWireProfile
}

const REASONING_SUMMARY = [
  // A literal default the assistant setting overwrites when present — later operation wins.
  { target: 'reasoningSummary', value: { source: 'literal', value: 'auto' } },
  { target: 'reasoningSummary', value: { source: 'assistant-summary' } }
] as const satisfies readonly { target: ReasoningWireTarget; value: ReasoningWireValue }[]

/**
 * OpenAI's own Responses reasoning wire: the shared effort vocabulary plus
 * `reasoning.summary`, which OpenAI leaves null unless asked — no summary means
 * no visible thinking at all. Third-party Responses hosts emit summaries on
 * their own and reject the field (Ark 400s `unknown field "summary"`), so this
 * wire stays opt-in per provider rather than being the format default.
 */
export const openaiResponsesSummaryWire: ReasoningWireProfile = {
  default: { operations: [...REASONING_SUMMARY] },
  off: { operations: [{ target: 'reasoningEffort', value: { source: 'literal', value: 'none' } }] },
  auto: {
    operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }, ...REASONING_SUMMARY],
    effortMap: { auto: 'medium' }
  },
  effort: { operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }, ...REASONING_SUMMARY] }
}
