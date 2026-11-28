import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { readImageMaxRetries, readRetryPolicy } = await import('../retryPolicy')

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
})

describe('readImageMaxRetries', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('defaults to 2 retries', () => {
    expect(readImageMaxRetries()).toBe(2)
  })

  it.each([
    [0, 0],
    [3.8, 3],
    [-3, 0],
    [99, 10]
  ])('normalizes configured attempts %s to %s (0 disables retries)', (configured, expected) => {
    MockMainPreferenceServiceUtils.setPreferenceValue('image.retry.max_attempts', configured)

    expect(readImageMaxRetries()).toBe(expected)
  })
})
