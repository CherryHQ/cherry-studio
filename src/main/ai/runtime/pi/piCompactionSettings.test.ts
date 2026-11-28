import { describe, expect, it } from 'vitest'

import { resolvePiCompactionSettings } from './piCompactionSettings'

describe('resolvePiCompactionSettings', () => {
  it('leaves the output reservation and an estimate margin below the trigger for a 49K model', () => {
    const { reserveTokens, keepRecentTokens } = resolvePiCompactionSettings(49_152, 8_192)

    expect(49_152 - reserveTokens).toBeGreaterThanOrEqual(8_192)
    expect(keepRecentTokens).toBeLessThan(49_152 - reserveTokens)
  })

  it('keeps the trigger at least a fifth of a small window', () => {
    const { reserveTokens, keepRecentTokens } = resolvePiCompactionSettings(8_000, 4_000)

    expect(8_000 - reserveTokens).toBeGreaterThanOrEqual(1_600)
    expect(keepRecentTokens).toBeLessThan(8_000 - reserveTokens)
  })
})
