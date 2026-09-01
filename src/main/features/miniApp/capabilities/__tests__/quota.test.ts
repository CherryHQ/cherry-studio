import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertWithinQuota,
  base64CharCap,
  HiddenBudget,
  MINI_APP_QUOTAS,
  QuotaExceededError,
  RateLimitedError,
  WriteRateLimiter
} from '../quota'

describe('assertWithinQuota', () => {
  const empty = { bytes: 0, count: 0 }

  it('accepts a write inside every limit', () => {
    expect(() => assertWithinQuota('storage', empty, { bytes: 10, count: 1 })).not.toThrow()
  })

  it('rejects exceeding the total byte budget', () => {
    const usage = { bytes: MINI_APP_QUOTAS.storage.bytes, count: 1 }
    expect(() => assertWithinQuota('storage', usage, { bytes: 1, count: 0 })).toThrow(QuotaExceededError)
  })

  it('rejects exceeding the entry count independently of size', () => {
    const usage = { bytes: 0, count: MINI_APP_QUOTAS.storage.count }
    expect(() => assertWithinQuota('storage', usage, { bytes: 1, count: 1 })).toThrow(QuotaExceededError)
  })

  it('converts a byte cap into a base64 length that still decodes under it', () => {
    const cap = base64CharCap(MINI_APP_QUOTAS.file.single)
    // A string at the cap must decode to no more than a padding unit over the quota,
    // or the pre-filter would let through what the real check then rejects.
    expect(Buffer.from('A'.repeat(cap), 'base64').byteLength).toBeLessThanOrEqual(MINI_APP_QUOTAS.file.single + 3)
  })

  it('rejects a single value larger than the per-entry cap', () => {
    expect(() => assertWithinQuota('storage', empty, { bytes: MINI_APP_QUOTAS.storage.single + 1, count: 1 })).toThrow(
      QuotaExceededError
    )
  })

  it('allows overwriting an existing entry with no count delta', () => {
    const usage = { bytes: 10, count: MINI_APP_QUOTAS.storage.count }
    expect(() => assertWithinQuota('storage', usage, { bytes: 5, count: 0 })).not.toThrow()
  })
})

describe('WriteRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('allows writes up to the per-second budget', () => {
    const limiter = new WriteRateLimiter(3)
    expect(() => {
      limiter.check('a')
      limiter.check('a')
      limiter.check('a')
    }).not.toThrow()
  })

  it('rejects the write past the budget', () => {
    const limiter = new WriteRateLimiter(2)
    limiter.check('a')
    limiter.check('a')
    expect(() => limiter.check('a')).toThrow(QuotaExceededError)
  })

  it('refills after the window elapses', () => {
    const limiter = new WriteRateLimiter(1)
    limiter.check('a')
    vi.advanceTimersByTime(1100)
    expect(() => limiter.check('a')).not.toThrow()
  })

  it('budgets each app separately', () => {
    const limiter = new WriteRateLimiter(1)
    limiter.check('a')
    expect(() => limiter.check('b')).not.toThrow()
  })
})

describe('HiddenBudget', () => {
  const GUEST = 7

  // Fake timers move `Date.now()` too, which is what makes the "time buys nothing" case
  // below able to fail: a reimplementation as a windowed rate limiter would refill here.
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('spends nothing while the guest is visible', () => {
    const budget = new HiddenBudget('ai.chat', 1)
    for (let i = 0; i < 50; i++) budget.check(GUEST, true)
    // Visible calls must not eat the background allowance, or an app used normally for a
    // minute would find itself already cut off the moment the user switches away.
    expect(() => budget.check(GUEST, false)).not.toThrow()
  })

  it('does NOT refill with time — only when the guest comes back', () => {
    // The whole reason this is not a rate: one call a minute is still 480 calls across an
    // evening. Time passing must buy nothing.
    const budget = new HiddenBudget('ai.chat', 2)
    budget.check(GUEST, false)
    budget.check(GUEST, false)
    vi.advanceTimersByTime(60 * 60 * 1000)

    expect(() => budget.check(GUEST, false)).toThrow(RateLimitedError)

    budget.reset(GUEST)
    expect(() => budget.check(GUEST, false)).not.toThrow()
  })

  it('says which limit was hit, so the activity log can be read', () => {
    // Both this and the per-minute cutoffs land in the activity log as refusals, and
    // "wait a minute" and "the user has to open the app again" are different instructions.
    const budget = new HiddenBudget('network.fetch', 1)
    budget.check(GUEST, false)

    expect(() => budget.check(GUEST, false)).toThrow(/background budget exhausted/)
  })

  it('budgets each guest separately', () => {
    // Visibility belongs to a pane: the same app in a detached window is another guest
    // that the user may well be looking at.
    const budget = new HiddenBudget('ai.chat', 1)
    budget.check(GUEST, false)

    expect(() => budget.check(GUEST + 1, false)).not.toThrow()
  })
})
