import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'

import { resolvePiCompactionSettings } from './piCompactionSettings'

const model = (contextWindow: number, maxOutputTokens: number) => ({ contextWindow, maxOutputTokens }) as Model

describe('resolvePiCompactionSettings', () => {
  it('keeps the 20K retained tail for a 49K window; the room after reserve and output allows it', () => {
    const { reserveTokens, keepRecentTokens } = resolvePiCompactionSettings(model(49_152, 8_192))
    expect(keepRecentTokens).toBe(20_000)
    expect(reserveTokens).toBeGreaterThanOrEqual(8_192)
    expect(reserveTokens + keepRecentTokens).toBeLessThan(49_152 - 8_192)
  })

  it('keeps the /compact summary input inside the window for a 65K-history session on a 49K model', () => {
    // A session switched to a smaller model summarizes saved history minus the retained tail;
    // shrinking the tail to window/4 (12,288) raised that input to ~52,630 tokens and overflowed.
    const { keepRecentTokens } = resolvePiCompactionSettings(model(49_152, 8_192))
    const savedHistoryTokens = 65_000
    expect(savedHistoryTokens - keepRecentTokens).toBeLessThanOrEqual(49_152)
  })

  it('derives integer budgets from fractional model metadata', () => {
    const { reserveTokens, keepRecentTokens } = resolvePiCompactionSettings(model(32_768.5, 8_192.5))
    expect(Number.isSafeInteger(reserveTokens)).toBe(true)
    expect(Number.isSafeInteger(keepRecentTokens)).toBe(true)
    expect(keepRecentTokens).toBeGreaterThanOrEqual(0)
  })

  it('shrinks the retained tail only as far as small-window room requires', () => {
    expect(resolvePiCompactionSettings(model(32_768, 8_192)).keepRecentTokens).toBe(8_192)
    expect(resolvePiCompactionSettings(model(20_000, 8_192)).keepRecentTokens).toBe(5_000)
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
      expect(keepRecentTokens).toBeLessThanOrEqual(20_000)
      expect(reserveTokens + keepRecentTokens).toBeLessThan(window)
    }
  )

  it('uses the shared fallback window and default output cap when metadata is absent', () => {
    expect(resolvePiCompactionSettings({} as Model)).toEqual({ reserveTokens: 33_792, keepRecentTokens: 20_000 })
  })
})
