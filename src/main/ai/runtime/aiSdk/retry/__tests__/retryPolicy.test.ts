import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { readRetryPolicy } = await import('../retryPolicy')

describe('readRetryPolicy', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it.each([
    [0, 1],
    [3.8, 3],
    [99, 10]
  ])('normalizes max attempts %s to %s once at the request boundary', (configured, expected) => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.max_attempts', configured)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.backoff_enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.fallback_model_ids', ['anthropic::claude'])

    expect(readRetryPolicy()).toEqual({
      enabled: true,
      maxAttempts: expected,
      backoffEnabled: true,
      fallbackModelIds: ['anthropic::claude']
    })
  })

  it('bounds the configured fallback list so one failed call cannot fan out to every model', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.enabled', true)
    const configured: RetryFallbackModelId[] = Array.from(
      { length: 9 },
      (_, index): RetryFallbackModelId => `provider::model-${index}`
    )
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.fallback_model_ids', configured)

    const { fallbackModelIds } = readRetryPolicy()

    expect(fallbackModelIds).not.toHaveLength(configured.length)
    expect(fallbackModelIds).toEqual(configured.slice(0, fallbackModelIds.length))
  })
})
