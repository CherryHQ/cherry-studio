/**
 * Pure-function tests for `computeBackoff`. Validates the three backoff
 * kinds and the `maxDelayMs` clamping behavior.
 */

import { computeBackoff } from '@main/core/job/runtime/backoff'
import type { RetryPolicy } from '@shared/data/api/schemas/jobs'
import { describe, expect, it } from 'vitest'

function policy(partial: Partial<RetryPolicy> & Pick<RetryPolicy, 'backoff'>): RetryPolicy {
  return {
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 60_000,
    ...partial
  }
}

describe('computeBackoff — none', () => {
  it('returns 0 for any attempt', () => {
    expect(computeBackoff(policy({ backoff: 'none' }), 1)).toBe(0)
    expect(computeBackoff(policy({ backoff: 'none' }), 5)).toBe(0)
    expect(computeBackoff(policy({ backoff: 'none' }), 99)).toBe(0)
  })
})

describe('computeBackoff — fixed', () => {
  it('returns baseDelayMs regardless of attempt', () => {
    expect(computeBackoff(policy({ backoff: 'fixed', baseDelayMs: 5000 }), 1)).toBe(5000)
    expect(computeBackoff(policy({ backoff: 'fixed', baseDelayMs: 5000 }), 10)).toBe(5000)
  })

  it('clamps to maxDelayMs when base exceeds it', () => {
    expect(computeBackoff(policy({ backoff: 'fixed', baseDelayMs: 100_000, maxDelayMs: 30_000 }), 1)).toBe(30_000)
  })
})

describe('computeBackoff — exponential', () => {
  it('attempt=1 returns baseDelayMs (no doubling on first try)', () => {
    expect(computeBackoff(policy({ backoff: 'exponential', baseDelayMs: 1000 }), 1)).toBe(1000)
  })

  it('doubles per attempt: 1, 2, 4, 8...', () => {
    const p = policy({ backoff: 'exponential', baseDelayMs: 1000, maxDelayMs: 1_000_000 })
    expect(computeBackoff(p, 1)).toBe(1000)
    expect(computeBackoff(p, 2)).toBe(2000)
    expect(computeBackoff(p, 3)).toBe(4000)
    expect(computeBackoff(p, 4)).toBe(8000)
  })

  it('clamps growth to maxDelayMs', () => {
    const p = policy({ backoff: 'exponential', baseDelayMs: 10_000, maxDelayMs: 30_000 })
    expect(computeBackoff(p, 1)).toBe(10_000)
    expect(computeBackoff(p, 2)).toBe(20_000)
    expect(computeBackoff(p, 3)).toBe(30_000) // 40k clamped
    expect(computeBackoff(p, 10)).toBe(30_000)
  })

  it('attempt below 1 floors to attempt=1 behavior (defensive)', () => {
    const p = policy({ backoff: 'exponential', baseDelayMs: 1000, maxDelayMs: 60_000 })
    expect(computeBackoff(p, 0)).toBe(1000)
    expect(computeBackoff(p, -5)).toBe(1000)
  })
})
