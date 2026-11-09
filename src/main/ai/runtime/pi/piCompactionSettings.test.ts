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

  it('reserves output plus estimator headroom for large windows', () => {
    expect(resolvePiCompactionSettings(model(1_000_000, 8_192))).toEqual({
      reserveTokens: 108_192,
      keepRecentTokens: 20_000
    })
  })
  it.each([1, 4_096, 16_384, 32_768, 65_536, 128_000, 256_000])(
    'keeps both budgets bounded for a %s-token window',
    (window) => {
      const { reserveTokens, keepRecentTokens } = resolvePiCompactionSettings(model(window, 8_192))
      expect(Number.isSafeInteger(reserveTokens)).toBe(true)
      expect(Number.isSafeInteger(keepRecentTokens)).toBe(true)
      expect(reserveTokens).toBeLessThanOrEqual(Math.floor(window / 2))
      expect(keepRecentTokens).toBeLessThanOrEqual(Math.floor(window / 4))
      expect(reserveTokens + keepRecentTokens).toBeLessThan(window)
    }
  )

  it('uses the shared fallback window and default output cap when metadata is absent', () => {
    expect(resolvePiCompactionSettings({} as Model)).toEqual({ reserveTokens: 33_792, keepRecentTokens: 20_000 })
  })
})
