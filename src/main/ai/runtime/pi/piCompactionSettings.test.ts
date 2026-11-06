import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'

import { resolvePiCompactionSettings } from './piCompactionSettings'

const model = (contextWindow: number, maxOutputTokens: number) => ({ contextWindow, maxOutputTokens }) as Model

describe('resolvePiCompactionSettings', () => {
  it('shrinks the retained tail for a 49K window and leaves output room', () => {
    const { reserveTokens, keepRecentTokens } = resolvePiCompactionSettings(model(49_152, 8_192))
    expect(keepRecentTokens).toBe(12_288)
    expect(reserveTokens).toBeGreaterThanOrEqual(8_192)
    expect(reserveTokens + keepRecentTokens).toBeLessThan(49_152 - 8_192)
  })

  it('keeps Pi defaults for large windows', () => {
    expect(resolvePiCompactionSettings(model(1_000_000, 8_192))).toEqual({
      reserveTokens: 108_192,
      keepRecentTokens: 20_000
    })
  })
})
