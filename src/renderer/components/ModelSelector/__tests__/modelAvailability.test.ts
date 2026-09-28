import { describe, expect, it } from 'vitest'

import type { ApiKeyLimitMap, ModelHealthMemory } from '@shared/data/preference/preferenceTypes'
import { createUniqueModelId, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { apiKeyLimitId, apiKeyModelLimitId, collectKeyUsage } from '@shared/utils/apiKeyLimit'
import { MODEL_HEALTH_STALE_AFTER_MS } from '@shared/utils/modelHealth'

import { getModelPassiveReason, getRemainingQuota, isQuotaExhausted } from '../modelAvailability'

const MODEL_ID = createUniqueModelId('deepseek', 'deepseek-chat')
const OTHER_MODEL_ID = createUniqueModelId('deepseek', 'deepseek-reasoner')
// No declared apiModelId — the recorded identity falls back to the bare catalog id, the common
// case. A model with a real apiModelId override is covered by its own test below.
const MODEL = { id: MODEL_ID, apiModelId: undefined } as Pick<Model, 'id' | 'apiModelId'>
const OTHER_MODEL = { id: OTHER_MODEL_ID, apiModelId: undefined } as Pick<Model, 'id' | 'apiModelId'>
// The bare wire model id, which is what `aiUsageRecord` actually stores.
const RAW_MODEL_ID = 'deepseek-chat'
const OTHER_RAW_MODEL_ID = 'deepseek-reasoner'

function provider(keys: Array<{ id: string; isEnabled: boolean }>): Provider {
  return { id: 'deepseek', apiKeys: keys } as unknown as Provider
}

/**
 * Spend, described the way the endpoint reports it — per (key, model) — and folded by the very
 * function production uses, so a fixture cannot drift from what a real response would produce.
 * `dropped` stands in for buckets the response left out past its limit.
 */
function usage(rows: Array<[keyId: string, modelId: string, requests: number]>, dropped = 0) {
  return collectKeyUsage(
    rows.map(([apiKeyId, modelId, requestCount]) => ({ groupBy: 'apiKeyModel', apiKeyId, modelId, requestCount })),
    { requestCount: dropped }
  )
}

const twoKeys = provider([
  { id: 'k1', isEnabled: true },
  { id: 'k2', isEnabled: true }
])

describe('getRemainingQuota', () => {
  it('adds up what is left across the provider keys that can be used', () => {
    const limits: ApiKeyLimitMap = {
      [apiKeyLimitId('deepseek', 'k1')]: { limit: 20, period: 'daily' },
      [apiKeyLimitId('deepseek', 'k2')]: { limit: 15, period: 'daily' }
    }
    const used = usage([
      ['k1', RAW_MODEL_ID, 5],
      ['k2', RAW_MODEL_ID, 15]
    ])

    // k1 has 15 left, k2 is spent.
    expect(getRemainingQuota(twoKeys, MODEL, limits, used)).toBe(15)
  })

  it('ignores a key the user switched off', () => {
    const limits: ApiKeyLimitMap = {
      [apiKeyLimitId('deepseek', 'k1')]: { limit: 20, period: 'daily' },
      [apiKeyLimitId('deepseek', 'k2')]: { limit: 15, period: 'daily' }
    }
    const disabled = provider([
      { id: 'k1', isEnabled: true },
      { id: 'k2', isEnabled: false }
    ])

    expect(getRemainingQuota(disabled, MODEL, limits, usage([]))).toBe(20)
  })

  it('prefers a ceiling set for this model over the key-wide one', () => {
    const limits: ApiKeyLimitMap = {
      [apiKeyLimitId('deepseek', 'k1')]: { limit: 100, period: 'daily' },
      [apiKeyModelLimitId('deepseek', 'k1', MODEL_ID)]: { limit: 10, period: 'daily' }
    }
    const single = provider([{ id: 'k1', isEnabled: true }])

    const spent = usage([['k1', RAW_MODEL_ID, 4]])
    expect(getRemainingQuota(single, MODEL, limits, spent)).toBe(6)
    // The model-scoped ceiling applies to that model only — and the key-scoped one the other
    // model falls back to is spent by every model on the key, this one included.
    expect(getRemainingQuota(single, OTHER_MODEL, limits, spent)).toBe(96)
  })

  // The whole point of a model-scoped ceiling: a free tier meters each model separately, so
  // traffic to one model must not spend another's allowance on the same key. Counting the key's
  // total against it made a heavily-used model bury every other model sharing that key.
  it('does not let another model on the same key spend a model-scoped ceiling', () => {
    const limits: ApiKeyLimitMap = {
      [apiKeyModelLimitId('deepseek', 'k1', MODEL_ID)]: { limit: 10, period: 'daily' }
    }
    const single = provider([{ id: 'k1', isEnabled: true }])
    const spentElsewhere = usage([['k1', OTHER_RAW_MODEL_ID, 50]])

    expect(getRemainingQuota(single, MODEL, limits, spentElsewhere)).toBe(10)
    expect(isQuotaExhausted(single, MODEL, limits, spentElsewhere)).toBe(false)
  })

  it('never reports a negative number when a key ran past its ceiling', () => {
    const limits: ApiKeyLimitMap = { [apiKeyLimitId('deepseek', 'k1')]: { limit: 10, period: 'daily' } }
    const single = provider([{ id: 'k1', isEnabled: true }])

    expect(getRemainingQuota(single, MODEL, limits, usage([['k1', RAW_MODEL_ID, 25]]))).toBe(0)
  })

  it('says nothing rather than zero when no key declares a ceiling', () => {
    // Most providers have no ceiling set. Reading that as "0 left" would badge every model as
    // spent and, through isQuotaExhausted, demote the entire picker.
    expect(getRemainingQuota(twoKeys, MODEL, {}, usage([]))).toBeUndefined()
    expect(getRemainingQuota(twoKeys, MODEL, undefined, undefined)).toBeUndefined()
  })

  // The recorded usage row holds the wire model id sent to the provider's SDK (`apiModelId`),
  // which can differ from the bare catalog id. Matching against the catalog id (or, worse, the
  // full UniqueModelId) silently never finds the usage, understating spend as unlimited.
  it('matches usage against the actual API model id, not the catalog id', () => {
    const modelWithApiId = { id: MODEL_ID, apiModelId: 'deepseek-chat-v3.1' }
    const limits: ApiKeyLimitMap = {
      [apiKeyModelLimitId('deepseek', 'k1', MODEL_ID)]: { limit: 10, period: 'daily' }
    }
    const spent = usage([['k1', 'deepseek-chat-v3.1', 4]])

    expect(getRemainingQuota(twoKeys, modelWithApiId, limits, spent)).toBe(6)
  })
})

describe('isQuotaExhausted', () => {
  it('is true only when every usable key is spent', () => {
    const limits: ApiKeyLimitMap = {
      [apiKeyLimitId('deepseek', 'k1')]: { limit: 10, period: 'daily' },
      [apiKeyLimitId('deepseek', 'k2')]: { limit: 10, period: 'daily' }
    }

    expect(isQuotaExhausted(twoKeys, MODEL, limits, usage([['k1', RAW_MODEL_ID, 10]]))).toBe(false)
    expect(
      isQuotaExhausted(
        twoKeys,
        MODEL,
        limits,
        usage([
          ['k1', RAW_MODEL_ID, 10],
          ['k2', RAW_MODEL_ID, 10]
        ])
      )
    ).toBe(true)
  })

  it('leaves a model alone when one of its keys has no declared ceiling', () => {
    // An unknown ceiling might well still answer; calling it spent would hide a working key.
    const limits: ApiKeyLimitMap = { [apiKeyLimitId('deepseek', 'k1')]: { limit: 10, period: 'daily' } }

    expect(isQuotaExhausted(twoKeys, MODEL, limits, usage([['k1', RAW_MODEL_ID, 10]]))).toBe(false)
  })

  // Past its limit the endpoint returns the top buckets plus an "other" remainder, so a key with
  // no bucket has spent an unknown amount. Reading that as zero would hand out room nobody
  // measured; reading it as spent would hide a key that still works.
  it('treats a key missing from a truncated response as unknown, not spent', () => {
    const limits: ApiKeyLimitMap = {
      [apiKeyLimitId('deepseek', 'k1')]: { limit: 10, period: 'daily' },
      [apiKeyLimitId('deepseek', 'k2')]: { limit: 10, period: 'daily' }
    }
    const truncated = usage([['k1', RAW_MODEL_ID, 10]], 400)

    expect(isQuotaExhausted(twoKeys, MODEL, limits, truncated)).toBe(false)
    // k1 is measured at its ceiling; k2 is unmeasured and contributes nothing knowable.
    expect(getRemainingQuota(twoKeys, MODEL, limits, truncated)).toBe(0)
  })
})

describe('getModelPassiveReason model health', () => {
  const model = { id: MODEL_ID, isEnabled: true } as unknown as Model

  it('demotes a model whose last probe failed a moment ago', () => {
    const health: ModelHealthMemory = { [MODEL_ID]: { ok: false, checkedAt: Date.now() } }

    expect(getModelPassiveReason(model, twoKeys, health)).toBe('unhealthy')
  })

  it('stops demoting once that failure is older than the staleness window', () => {
    const health: ModelHealthMemory = {
      [MODEL_ID]: { ok: false, checkedAt: Date.now() - MODEL_HEALTH_STALE_AFTER_MS - 1 }
    }

    expect(getModelPassiveReason(model, twoKeys, health)).toBeUndefined()
  })

  it('treats the exact staleness boundary as expired, not fresh', () => {
    const health: ModelHealthMemory = { [MODEL_ID]: { ok: false, checkedAt: Date.now() - MODEL_HEALTH_STALE_AFTER_MS } }

    expect(getModelPassiveReason(model, twoKeys, health)).toBeUndefined()
  })
})
