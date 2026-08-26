import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assertWithinQuota, base64CharCap, MINI_APP_QUOTAS, QuotaExceededError, WriteRateLimiter } from '../quota'

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
