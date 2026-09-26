import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { readRetryPolicy } = await import('../retryPolicy')

describe('readRetryPolicy', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.backoff_enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.fallback_model_ids', ['anthropic::claude'])
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.routing.auto_switch_enabled', true)
  })

  it.each([
    [0, 1],
    [3.8, 3],
    [99, 10]
  ])('normalizes max attempts %s to %s once at the request boundary', (configured, expected) => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.max_attempts', configured)

    expect(readRetryPolicy()).toEqual({
      enabled: true,
      maxAttempts: expected,
      backoffEnabled: true,
      fallbackModelIds: ['anthropic::claude']
    })
  })

  it('withholds every fallback while auto switch is off, so the chosen model stays the one that answers', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.routing.auto_switch_enabled', false)

    expect(readRetryPolicy().fallbackModelIds).toEqual([])
  })

  it('keeps same-model retry available while auto switch is off', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.routing.auto_switch_enabled', false)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.max_attempts', 3)

    expect(readRetryPolicy()).toMatchObject({ enabled: true, maxAttempts: 3 })
  })

  it('appends local worker model as last-resort fallback when configured', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.routing.local_worker_model', 'lmstudio::local-model')
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.fallback_model_ids', ['anthropic::claude'])
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.routing.auto_switch_enabled', true)

    expect(readRetryPolicy().fallbackModelIds).toEqual(['anthropic::claude', 'lmstudio::local-model'])
  })

  it('does not duplicate local worker model if already in fallback list', () => {
    const localModel = 'lmstudio::local-model'
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.routing.local_worker_model', localModel)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.fallback_model_ids', [localModel])
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.routing.auto_switch_enabled', true)

    expect(readRetryPolicy().fallbackModelIds).toEqual([localModel])
  })

  it('omits local worker model when auto switch is off', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.routing.local_worker_model', 'lmstudio::local-model')
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.routing.auto_switch_enabled', false)

    expect(readRetryPolicy().fallbackModelIds).toEqual([])
  })
})
