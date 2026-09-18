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

const key = (id: string) => ({ id, key: `secret-${id}`, isEnabled: true }) as ApiKeyEntry

function withLimits(limits: Record<string, { limit: number; period: 'daily' | 'monthly' }>) {
  preferenceGet.mockReturnValue(limits)
}

function withRequestCounts(counts: Record<string, number>) {
  stats.mockReturnValue({
    buckets: Object.entries(counts).map(([apiKeyId, requestCount]) => ({
      groupBy: 'apiKey' as const,
      apiKeyId,
      requestCount
    }))
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
      [apiKeyModelLimitId('deepseek', 'a', 'deepseek-v4-flash')]: { limit: 5, period: 'daily' }
    })
    withRequestCounts({ a: 5 })

    expect(filterKeysWithinQuota('deepseek', [key('a'), key('b')], 'deepseek-v4-flash')).toEqual([key('b')])
  })

  it('falls back to key-level limit when no model-scoped limit exists', () => {
    withLimits({
      [apiKeyLimitId('deepseek', 'a')]: { limit: 10, period: 'daily' }
    })
    withRequestCounts({ a: 10 })

    expect(filterKeysWithinQuota('deepseek', [key('a'), key('b')], 'deepseek-v4-flash')).toEqual([key('b')])
  })

  it('two keys with separate model-scoped limits filter independently', () => {
    withLimits({
      [apiKeyModelLimitId('deepseek', 'a', 'deepseek-v4-flash')]: { limit: 20, period: 'daily' },
      [apiKeyModelLimitId('deepseek', 'b', 'deepseek-v4-flash')]: { limit: 15, period: 'daily' }
    })
    withRequestCounts({ a: 20, b: 10 })

    const result = filterKeysWithinQuota('deepseek', [key('a'), key('b')], 'deepseek-v4-flash')
    expect(result).toEqual([key('b')])
  })
})
