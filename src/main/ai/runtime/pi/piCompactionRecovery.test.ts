import { describe, expect, it } from 'vitest'

import { resolvePiCompactionSettings } from './piCompactionSettings'

const model = { contextWindow: 49_152, maxTokens: 8_192 }

describe('Pi compaction budgets', () => {
  it('compacts early and leaves room for a 49K model response', () => {
    expect(resolvePiCompactionSettings(model)).toEqual({
      enabled: true,
      reserveTokens: 24_576,
      keepRecentTokens: 8_192
    })
  })
  it.each([49_152, 100_000, 128_000, 200_000])(
    'caps catalog reservations at a quarter of %i context',
    (contextWindow) => {
      for (const maxTokens of [contextWindow - 1, contextWindow, contextWindow * 2]) {
        const settings = resolvePiCompactionSettings({ contextWindow, maxTokens })
        expect(settings.reserveTokens).toBeLessThanOrEqual(contextWindow / 2)
        expect(settings.keepRecentTokens).toBeGreaterThanOrEqual(4_096)
        expect(settings.keepRecentTokens + 4_096 + 8_192).toBeLessThan(contextWindow - settings.reserveTokens)
      }
    }
  )
  it('keeps the stock retained tail on large models', () => {
    expect(resolvePiCompactionSettings({ contextWindow: 200_000, maxTokens: 8192 })).toEqual({
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000
    })
  })
})
