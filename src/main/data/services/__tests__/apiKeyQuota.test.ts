import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiKeyEntry } from '@shared/data/types/provider'

const preferenceGet = vi.fn()
const stats = vi.fn()

vi.mock('@application', () => ({
  application: { get: () => ({ get: preferenceGet }) }
}))
vi.mock('../AiUsageRecordService', () => ({
  aiUsageRecordService: { stats: (...args: unknown[]) => stats(...args) }
}))

const { apiKeyLimitId, apiKeyModelLimitId, filterKeysWithinQuota } = await import('../apiKeyQuota')

const key = (id: string, renewal?: { renewalAnchor?: string; renewalTimezone?: string }) =>
  ({ id, key: `secret-${id}`, isEnabled: true, ...renewal }) as ApiKeyEntry

function withLimits(limits: Record<string, { limit: number; period: 'daily' | 'weekly' | 'monthly' | 'total' }>) {
  preferenceGet.mockReturnValue(limits)
}

const MODEL_A = 'groq::llama-70b' as const
const MODEL_B = 'groq::whisper' as const

/** Spend on a key across every model, the way a response with a single model per key folds. */
function withRequestCounts(counts: Record<string, number>) {
  withModelRequestCounts(Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, { [MODEL_A]: n }])))
}

/** Spend per (key, model) — what the endpoint actually returns for `groupBy: 'apiKeyModel'`. */
function withModelRequestCounts(counts: Record<string, Record<string, number>>, dropped = 0) {
  stats.mockReturnValue({
    buckets: Object.entries(counts).flatMap(([apiKeyId, byModel]) =>
      Object.entries(byModel).map(([modelId, requestCount]) => ({
        groupBy: 'apiKeyModel' as const,
        apiKeyId,
        modelId,
        requestCount
      }))
    ),
    other: { requestCount: dropped }
  })
}

describe('filterKeysWithinQuota', () => {
  beforeEach(() => {
    preferenceGet.mockReset()
    stats.mockReset()
  })

  it('drops a key that reached its declared ceiling', () => {
    withLimits({ [apiKeyLimitId('groq', 'a')]: { limit: 100, period: 'daily' } })
    withRequestCounts({ a: 100 })

    expect(filterKeysWithinQuota('groq', [key('a'), key('b')])).toEqual([key('b')])
  })

  it('keeps a key that still has headroom', () => {
    withLimits({ [apiKeyLimitId('groq', 'a')]: { limit: 100, period: 'daily' } })
    withRequestCounts({ a: 99 })

    expect(filterKeysWithinQuota('groq', [key('a')])).toEqual([key('a')])
  })

  it('returns every key when all of them are exhausted, so the request is still attempted', () => {
    withLimits({
      [apiKeyLimitId('groq', 'a')]: { limit: 10, period: 'daily' },
      [apiKeyLimitId('groq', 'b')]: { limit: 10, period: 'daily' }
    })
    withRequestCounts({ a: 10, b: 10 })

    expect(filterKeysWithinQuota('groq', [key('a'), key('b')])).toHaveLength(2)
  })

  it('skips the usage query entirely when no key has a limit', () => {
    withLimits({})

    expect(filterKeysWithinQuota('groq', [key('a')])).toEqual([key('a')])
    expect(stats).not.toHaveBeenCalled()
  })

  it('falls back to every key when the usage lookup throws', () => {
    withLimits({ [apiKeyLimitId('groq', 'a')]: { limit: 1, period: 'daily' } })
    stats.mockImplementation(() => {
      throw new Error('db unavailable')
    })

    expect(filterKeysWithinQuota('groq', [key('a'), key('b')])).toHaveLength(2)
  })

  it('model-scoped limit takes precedence over key-level limit', () => {
    withLimits({
      [apiKeyLimitId('deepseek', 'a')]: { limit: 100, period: 'daily' },
      [apiKeyModelLimitId('deepseek', 'a', 'deepseek::deepseek-v4-flash')]: { limit: 5, period: 'daily' }
    })
    withModelRequestCounts({ a: { 'deepseek::deepseek-v4-flash': 5 } })

    expect(filterKeysWithinQuota('deepseek', [key('a'), key('b')], 'deepseek::deepseek-v4-flash')).toEqual([key('b')])
  })

  it('falls back to key-level limit when no model-scoped limit exists', () => {
    withLimits({
      [apiKeyLimitId('deepseek', 'a')]: { limit: 10, period: 'daily' }
    })
    withRequestCounts({ a: 10 })

    expect(filterKeysWithinQuota('deepseek', [key('a'), key('b')], 'deepseek::deepseek-v4-flash')).toEqual([key('b')])
  })

  it('two keys with separate model-scoped limits filter independently', () => {
    withLimits({
      [apiKeyModelLimitId('deepseek', 'a', 'deepseek::deepseek-v4-flash')]: { limit: 20, period: 'daily' },
      [apiKeyModelLimitId('deepseek', 'b', 'deepseek::deepseek-v4-flash')]: { limit: 15, period: 'daily' }
    })
    withModelRequestCounts({
      a: { 'deepseek::deepseek-v4-flash': 20 },
      b: { 'deepseek::deepseek-v4-flash': 10 }
    })

    const result = filterKeysWithinQuota('deepseek', [key('a'), key('b')], 'deepseek::deepseek-v4-flash')
    expect(result).toEqual([key('b')])
  })

  it('total period counts from epoch and never resets', () => {
    withLimits({ [apiKeyLimitId('openrouter', 'a')]: { limit: 10, period: 'total' } })
    withRequestCounts({ a: 10 })

    expect(filterKeysWithinQuota('openrouter', [key('a'), key('b')])).toEqual([key('b')])
    expect(stats).toHaveBeenCalledWith(expect.objectContaining({ from: 0 }))
  })
  // A free tier meters each model separately, which is the only reason a model-scoped ceiling
  // exists. Measuring it against the key's whole traffic let a busy model exhaust every other
  // model that shares the key, and the router then skipped credentials that had room.
  it('does not let another model on the same key spend a model-scoped ceiling', () => {
    withLimits({ [apiKeyModelLimitId('groq', 'a', MODEL_A)]: { limit: 10, period: 'daily' } })
    withModelRequestCounts({ a: { [MODEL_B]: 50 } })

    expect(filterKeysWithinQuota('groq', [key('a'), key('b')], MODEL_A)).toEqual([key('a'), key('b')])
  })

  it('drops the key once that model itself reaches the model-scoped ceiling', () => {
    withLimits({
      [apiKeyLimitId('groq', 'a')]: { limit: 100, period: 'daily' },
      [apiKeyModelLimitId('groq', 'a', MODEL_A)]: { limit: 10, period: 'daily' }
    })
    withModelRequestCounts({ a: { [MODEL_A]: 10, [MODEL_B]: 1 } })

    expect(filterKeysWithinQuota('groq', [key('a'), key('b')], MODEL_A)).toEqual([key('b')])
  })

  it('spends a key-scoped ceiling with every model on that key', () => {
    withLimits({ [apiKeyLimitId('groq', 'a')]: { limit: 10, period: 'daily' } })
    withModelRequestCounts({ a: { [MODEL_A]: 6, [MODEL_B]: 4 } })

    expect(filterKeysWithinQuota('groq', [key('a'), key('b')], MODEL_A)).toEqual([key('b')])
  })

  // Past its limit the endpoint returns the top buckets plus an "other" remainder, so a key with
  // no bucket spent an unknown amount. Withholding it would refuse a request on a guess; the
  // provider rejecting the call is the honest failure.
  it('keeps a key whose spend the truncated response never reported', () => {
    withLimits({ [apiKeyLimitId('groq', 'a')]: { limit: 10, period: 'daily' } })
    withModelRequestCounts({ c: { [MODEL_A]: 99 } }, 5000)

    expect(filterKeysWithinQuota('groq', [key('a'), key('b')], MODEL_A)).toEqual([key('a'), key('b')])
  })
  // The renewal day is set per key in provider settings and the widget already counts from it.
  // The router read the calendar default instead, so a ceiling the screen showed as renewing on
  // the 15th kept resetting on the 1st — the same data answered two different ways.
  it('counts a monthly ceiling from the key own renewal day, not the first of the month', () => {
    withLimits({ [apiKeyLimitId('groq', 'a')]: { limit: 10, period: 'monthly' } })
    withModelRequestCounts({ a: { [MODEL_A]: 1 } })

    filterKeysWithinQuota(
      'groq',
      [key('a', { renewalAnchor: '2024-01-15', renewalTimezone: 'UTC' }), key('b')],
      MODEL_A
    )

    const from = stats.mock.calls.at(-1)?.[0]?.from as number
    expect(new Date(from).getUTCDate()).toBe(15)
  })

  it('gives two keys renewing on different days their own counting window', () => {
    withLimits({
      [apiKeyLimitId('groq', 'a')]: { limit: 10, period: 'monthly' },
      [apiKeyLimitId('groq', 'b')]: { limit: 10, period: 'monthly' }
    })
    withModelRequestCounts({ a: { [MODEL_A]: 1 } })

    filterKeysWithinQuota(
      'groq',
      [
        key('a', { renewalAnchor: '2024-01-05', renewalTimezone: 'UTC' }),
        key('b', { renewalAnchor: '2024-01-20', renewalTimezone: 'UTC' })
      ],
      MODEL_A
    )

    const days = stats.mock.calls.map(([q]) => new Date((q as { from: number }).from).getUTCDate())
    expect(new Set(days)).toEqual(new Set([5, 20]))
  })
})
