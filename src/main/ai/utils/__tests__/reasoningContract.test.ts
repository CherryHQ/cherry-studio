/**
 * PERMANENT acceptance gate for the descriptor-driven reasoning path (#16598).
 *
 * Not a characterization test: while the goldens freeze exact outputs, this
 * asserts the two CONTRACTS the migration exists to establish, over every
 * reasoning model the shipped registry serves:
 *
 *  1. Every vocabulary effort a model offers serializes to a NON-EMPTY wire
 *     payload (no failure-mode-B: option offered but dropped).
 *  2. A discrete effort that rides the wire as an effort string rides
 *     VERBATIM (no failure-mode-C: silent downgrade). `'auto'` is exempt —
 *     it is a mode, and several dialects legitimately translate it
 *     (openrouter → 'medium', budget models → -1). Budget dialects don't
 *     carry an effort string at all — their contract is the non-empty check.
 */
import { isOpenAIDeepResearchModel } from '@shared/utils/model'
import { describe, expect, it } from 'vitest'

import { getReasoningEffort } from '../reasoning'
import { assistantFor, buildCatalogRows, buildEnrichedSyntheticRows } from './reasoningMatrix'

const POPULATIONS = [
  ['catalog', buildCatalogRows()],
  ['enriched synthetic', buildEnrichedSyntheticRows()]
] as const

/**
 * The REVIEWED exemption list — providers whose dialect knowingly drops or
 * remaps part of a model vocabulary (issue #16598's "explicit, reviewable
 * list" of silently-dropped triples). Shrinking this list is the goal;
 * growing it requires review.
 */
const EXEMPT_PROVIDERS: Record<string, string> = {
  // Wire branch is exhaustive: only qwen/glm/deepseek/hunyuan get
  // enable_thinking; other families are never sent reasoning params.
  silicon: 'legacy-exhaustive enable_thinking branch',
  // extra_body wrapper covers gpt/claude/gemini families only.
  poe: 'extra_body wrapper covers gpt/claude/gemini only',
  // Together's API accepts low/medium/high only; other tiers are remapped.
  together: 'API accepts low/medium/high only',
  // Disable-only dialect: the ON state is parameter-free.
  cerebras: 'disable_reasoning-only dialect'
}

/** `xhigh` and `max` are the same tier under two vendor spellings. */
const sameTier = (a: string, b: string) => a === b || (['xhigh', 'max'].includes(a) && ['xhigh', 'max'].includes(b))

/** Effort strings anywhere in the wire payload. */
function wireEfforts(out: Record<string, any>): string[] {
  return [out.reasoningEffort, out.reasoning_effort, out.reasoning?.effort, out.extra_body?.reasoning_effort].filter(
    (v): v is string => typeof v === 'string'
  )
}

describe.each(POPULATIONS)('reasoning serializer contract — %s rows', (_name, rows) => {
  const testable = rows.filter(
    (row) =>
      (row.model.reasoning?.supportedEfforts?.length ?? 0) > 0 &&
      !EXEMPT_PROVIDERS[row.provider.id] &&
      // openai deep-research pins effort=medium regardless of vocabulary
      !isOpenAIDeepResearchModel(row.model)
  )

  it('covers a meaningful population', () => {
    expect(testable.length).toBeGreaterThan(100)
  })

  it('serializes every offered vocabulary effort to a non-empty payload', () => {
    const offenders: string[] = []
    for (const row of testable) {
      const hasEffortControl = row.model.reasoning!.controls?.some((c) => c.kind === 'effort') ?? false
      for (const effort of row.model.reasoning!.supportedEfforts) {
        if (effort === 'none') continue // off may legitimately serialize to {} (hybrid default-off dialects)
        // Toggle-vocabulary models: 'auto' (= on) may be the dialect's
        // parameter-free default state (minimax/nemotron have no wire knob).
        if (effort === 'auto' && !hasEffortControl) continue
        const out = getReasoningEffort(assistantFor(effort), row.model, row.provider)
        if (Object.keys(out).length === 0) {
          offenders.push(`${row.key} @ ${effort}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('never silently downgrades a discrete effort that rides as an effort string', () => {
    const offenders: string[] = []
    for (const row of testable) {
      for (const effort of row.model.reasoning!.supportedEfforts) {
        if (effort === 'none' || effort === 'auto') continue
        const out = getReasoningEffort(assistantFor(effort), row.model, row.provider)
        for (const wire of wireEfforts(out)) {
          if (!sameTier(wire, effort)) offenders.push(`${row.key} @ ${effort} → ${wire}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
