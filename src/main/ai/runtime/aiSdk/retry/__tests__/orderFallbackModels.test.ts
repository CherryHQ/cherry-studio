import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelHealthMemory, RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'
import type { ApiKeyTier } from '@shared/data/types/provider'
import { MODEL_HEALTH_STALE_AFTER_MS } from '@shared/utils/modelHealth'

const getApiKeys = vi.fn()
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getApiKeys: (...a: unknown[]) => getApiKeys(...a) }
}))

const { orderFallbackModels } = await import('../orderFallbackModels')

const id = (value: string) => value as RetryFallbackModelId

const healthy = (checkedAt = Date.now()) => ({ ok: true, checkedAt })
const broken = (checkedAt = Date.now()) => ({ ok: false, checkedAt })

type ApiKeyStub = { id: string; isEnabled: boolean; tier?: ApiKeyTier }
const apiKeysByProvider = new Map<string, ApiKeyStub[] | 'throw'>()

beforeEach(() => {
  apiKeysByProvider.clear()
  getApiKeys.mockReset()
  getApiKeys.mockImplementation((providerId: string) => {
    const entry = apiKeysByProvider.get(providerId)
    if (entry === 'throw') throw new Error('provider unavailable')
    return entry ?? []
  })
})

/** Registers the enabled keys `getApiKeys` returns for a given provider id. */
function keysOf(providerId: string, tiers: readonly (ApiKeyTier | undefined)[]) {
  apiKeysByProvider.set(
    providerId,
    tiers.map((tier, i) => ({ id: `${providerId}-${i}`, isEnabled: true, tier }))
  )
}

/** Simulates a deleted provider or other lookup failure. */
function unavailable(providerId: string) {
  apiKeysByProvider.set(providerId, 'throw')
}

describe('orderFallbackModels', () => {
  it('tries a model whose last probe failed after one that has never been probed', () => {
    const ids = [id('openai::gpt-4o'), id('groq::llama-3.1-70b')]
    const health: ModelHealthMemory = { 'openai::gpt-4o': broken() }

    expect(orderFallbackModels(ids, health)).toEqual([id('groq::llama-3.1-70b'), id('openai::gpt-4o')])
  })

  it('puts a probed-healthy model ahead of an unprobed higher-quality one', () => {
    const ids = [id('openai::gpt-3.5-turbo'), id('anthropic::claude-opus-4')]
    const health: ModelHealthMemory = { 'openai::gpt-3.5-turbo': healthy() }

    expect(orderFallbackModels(ids, health)[0]).toBe(id('openai::gpt-3.5-turbo'))
  })

  it('breaks ties within the same health tier by quality score', () => {
    const ids = [id('openai::gpt-3.5-turbo'), id('anthropic::claude-opus-4')]
    const health: ModelHealthMemory = { 'openai::gpt-3.5-turbo': healthy(), 'anthropic::claude-opus-4': healthy() }

    expect(orderFallbackModels(ids, health)).toEqual([id('anthropic::claude-opus-4'), id('openai::gpt-3.5-turbo')])
  })

  it('keeps every configured fallback, since a failed provider may have recovered', () => {
    const ids = [id('openai::gpt-4o'), id('groq::llama-3.1-70b')]
    const health: ModelHealthMemory = { 'openai::gpt-4o': broken(), 'groq::llama-3.1-70b': broken() }

    expect(orderFallbackModels(ids, health)).toHaveLength(2)
  })

  it('ranks an unprobed model ahead of one whose failure has gone stale', () => {
    const ids = [id('openai::gpt-4o'), id('groq::llama-3.1-70b')]
    const health: ModelHealthMemory = {
      'openai::gpt-4o': broken(Date.now() - MODEL_HEALTH_STALE_AFTER_MS - 1)
    }

    // A stale failure reads as unknown, the same tier as never having been probed — quality then
    // decides, and gpt-4o outranks llama-3.1-70b there.
    expect(orderFallbackModels(ids, health)).toEqual([id('openai::gpt-4o'), id('groq::llama-3.1-70b')])
  })

  it('treats a failure recorded exactly at the staleness boundary as expired, not fresh', () => {
    const ids = [id('openai::gpt-4o'), id('groq::llama-3.1-70b')]
    const health: ModelHealthMemory = { 'openai::gpt-4o': broken(Date.now() - MODEL_HEALTH_STALE_AFTER_MS) }

    expect(orderFallbackModels(ids, health)).toEqual([id('openai::gpt-4o'), id('groq::llama-3.1-70b')])
  })

  it('prefers a free-tier provider over a paid-tier one when health does not separate them', () => {
    keysOf('freeprov', ['free'])
    keysOf('paidprov', ['paid'])
    const ids = [id('paidprov::model'), id('freeprov::model')]

    expect(orderFallbackModels(ids, {})).toEqual([id('freeprov::model'), id('paidprov::model')])
  })

  it('ranks a trial-tier provider between free and paid', () => {
    keysOf('freeprov', ['free'])
    keysOf('trialprov', ['trial'])
    keysOf('paidprov', ['paid'])
    const ids = [id('paidprov::model'), id('trialprov::model'), id('freeprov::model')]

    expect(orderFallbackModels(ids, {})).toEqual([id('freeprov::model'), id('trialprov::model'), id('paidprov::model')])
  })

  it('keeps a healthy paid model ahead of a free model that just failed', () => {
    keysOf('freeprov', ['free'])
    keysOf('paidprov', ['paid'])
    const ids = [id('freeprov::model'), id('paidprov::model')]
    const health: ModelHealthMemory = { 'freeprov::model': broken(), 'paidprov::model': healthy() }

    expect(orderFallbackModels(ids, health)).toEqual([id('paidprov::model'), id('freeprov::model')])
  })

  it('collapses a provider to free tier when only one of its several keys is free', () => {
    keysOf('mixed', ['paid', 'free', 'paid'])
    keysOf('allpaid', ['paid'])
    const ids = [id('allpaid::model'), id('mixed::model')]

    expect(orderFallbackModels(ids, {})).toEqual([id('mixed::model'), id('allpaid::model')])
  })

  it('treats a key without a declared tier as free, matching the documented default', () => {
    keysOf('undeclared', [undefined])
    keysOf('paidprov', ['paid'])
    const ids = [id('paidprov::model'), id('undeclared::model')]

    expect(orderFallbackModels(ids, {})).toEqual([id('undeclared::model'), id('paidprov::model')])
  })

  it('ranks a provider whose key lookup fails as paid, without throwing', () => {
    unavailable('broken')
    keysOf('freeprov', ['free'])
    const ids = [id('broken::model'), id('freeprov::model')]

    expect(orderFallbackModels(ids, {})).toEqual([id('freeprov::model'), id('broken::model')])
  })
})
