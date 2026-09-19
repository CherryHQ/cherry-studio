import { describe, expect, it } from 'vitest'

import type { ApiKeyLimitMap, ModelHealthMemory } from '@shared/data/preference/preferenceTypes'
import { createUniqueModelId, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { apiKeyLimitId, apiKeyModelLimitId } from '@shared/utils/apiKeyLimit'
import { MODEL_HEALTH_STALE_AFTER_MS } from '@shared/utils/modelHealth'

import { getModelPassiveReason, getRemainingQuota, isQuotaExhausted } from '../modelAvailability'

const MODEL_ID = createUniqueModelId('deepseek', 'deepseek-chat')
const OTHER_MODEL_ID = createUniqueModelId('deepseek', 'deepseek-reasoner')

function provider(keys: Array<{ id: string; isEnabled: boolean }>): Provider {
  return { id: 'deepseek', apiKeys: keys } as unknown as Provider
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
    const used = new Map([
      ['k1', 5],
      ['k2', 15]
    ])

    // k1 has 15 left, k2 is spent.
    expect(getRemainingQuota(twoKeys, MODEL_ID, limits, used)).toBe(15)
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

    expect(getRemainingQuota(disabled, MODEL_ID, limits, new Map())).toBe(20)
  })

  it('prefers a ceiling set for this model over the key-wide one', () => {
    const limits: ApiKeyLimitMap = {
      [apiKeyLimitId('deepseek', 'k1')]: { limit: 100, period: 'daily' },
      [apiKeyModelLimitId('deepseek', 'k1', MODEL_ID)]: { limit: 10, period: 'daily' }
    }
    const single = provider([{ id: 'k1', isEnabled: true }])

    expect(getRemainingQuota(single, MODEL_ID, limits, new Map([['k1', 4]]))).toBe(6)
    // The model-scoped ceiling applies to that model only.
    expect(getRemainingQuota(single, OTHER_MODEL_ID, limits, new Map([['k1', 4]]))).toBe(96)
  })

  it('never reports a negative number when a key ran past its ceiling', () => {
    const limits: ApiKeyLimitMap = { [apiKeyLimitId('deepseek', 'k1')]: { limit: 10, period: 'daily' } }
    const single = provider([{ id: 'k1', isEnabled: true }])

    expect(getRemainingQuota(single, MODEL_ID, limits, new Map([['k1', 25]]))).toBe(0)
  })

  it('says nothing rather than zero when no key declares a ceiling', () => {
    // Most providers have no ceiling set. Reading that as "0 left" would badge every model as
    // spent and, through isQuotaExhausted, demote the entire picker.
    expect(getRemainingQuota(twoKeys, MODEL_ID, {}, new Map())).toBeUndefined()
    expect(getRemainingQuota(twoKeys, MODEL_ID, undefined, undefined)).toBeUndefined()
  })
})

describe('isQuotaExhausted', () => {
  it('is true only when every usable key is spent', () => {
    const limits: ApiKeyLimitMap = {
      [apiKeyLimitId('deepseek', 'k1')]: { limit: 10, period: 'daily' },
      [apiKeyLimitId('deepseek', 'k2')]: { limit: 10, period: 'daily' }
    }

    expect(isQuotaExhausted(twoKeys, MODEL_ID, limits, new Map([['k1', 10]]))).toBe(false)
    expect(
      isQuotaExhausted(
        twoKeys,
        MODEL_ID,
        limits,
        new Map([
          ['k1', 10],
          ['k2', 10]
        ])
      )
    ).toBe(true)
  })

  it('leaves a model alone when one of its keys has no declared ceiling', () => {
    // An unknown ceiling might well still answer; calling it spent would hide a working key.
    const limits: ApiKeyLimitMap = { [apiKeyLimitId('deepseek', 'k1')]: { limit: 10, period: 'daily' } }

    expect(isQuotaExhausted(twoKeys, MODEL_ID, limits, new Map([['k1', 10]]))).toBe(false)
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
