import { describe, expect, it } from 'vitest'

import { normalizeAutoCompactTriggerPct } from '../agentAutoCompact'

describe('normalizeAutoCompactTriggerPct', () => {
  it('falls back to the Cherry Studio default when unset or invalid', () => {
    expect(normalizeAutoCompactTriggerPct(undefined)).toBe(80)
    expect(normalizeAutoCompactTriggerPct('50')).toBe(80)
    expect(normalizeAutoCompactTriggerPct(Number.NaN)).toBe(80)
  })

  it('clamps into the Cherry Studio policy range', () => {
    expect(normalizeAutoCompactTriggerPct(50)).toBe(50)
    expect(normalizeAutoCompactTriggerPct(5)).toBe(10)
    expect(normalizeAutoCompactTriggerPct(95)).toBe(80)
    expect(normalizeAutoCompactTriggerPct(49.6)).toBe(50)
  })
})
