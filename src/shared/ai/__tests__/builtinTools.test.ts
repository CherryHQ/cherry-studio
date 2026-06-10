import { describe, expect, it } from 'vitest'

import { kbSearchInputSchema } from '../builtinTools'

/**
 * `kbSearchInputSchema` is the only validation gate for the kb__search tool —
 * neither the tool nor KnowledgeService clamps the per-call knobs — so out-of-range
 * values must be rejected here or they reach the index unchecked (e.g. a topK above
 * the cap over-fetches). These tests pin every boundary. (hybridAlpha is per-base
 * config, not a per-call knob, so it is not part of this schema.)
 */
describe('kbSearchInputSchema', () => {
  const valid = { query: 'cache invalidation', baseIds: ['kb-1'] }

  it('accepts a minimal valid input and the full set of in-range knobs', () => {
    expect(kbSearchInputSchema.safeParse(valid).success).toBe(true)
    expect(kbSearchInputSchema.safeParse({ ...valid, topK: 50, threshold: 0 }).success).toBe(true)
  })

  it('rejects a query shorter than 2 chars or longer than 200', () => {
    expect(kbSearchInputSchema.safeParse({ ...valid, query: 'a' }).success).toBe(false)
    expect(kbSearchInputSchema.safeParse({ ...valid, query: 'x'.repeat(201) }).success).toBe(false)
  })

  it('requires at least one baseId', () => {
    expect(kbSearchInputSchema.safeParse({ ...valid, baseIds: [] }).success).toBe(false)
    expect(kbSearchInputSchema.safeParse({ ...valid, baseIds: [''] }).success).toBe(false)
  })

  it('rejects topK that is non-positive, fractional, or above 50', () => {
    expect(kbSearchInputSchema.safeParse({ ...valid, topK: 0 }).success).toBe(false)
    expect(kbSearchInputSchema.safeParse({ ...valid, topK: 2.5 }).success).toBe(false)
    expect(kbSearchInputSchema.safeParse({ ...valid, topK: 51 }).success).toBe(false)
  })

  it('rejects threshold outside [0, 1]', () => {
    expect(kbSearchInputSchema.safeParse({ ...valid, threshold: -0.01 }).success).toBe(false)
    expect(kbSearchInputSchema.safeParse({ ...valid, threshold: 1.01 }).success).toBe(false)
  })

  it('treats every knob as optional (omitting them is valid)', () => {
    const parsed = kbSearchInputSchema.safeParse(valid)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.topK).toBeUndefined()
      expect(parsed.data.threshold).toBeUndefined()
    }
  })
})
