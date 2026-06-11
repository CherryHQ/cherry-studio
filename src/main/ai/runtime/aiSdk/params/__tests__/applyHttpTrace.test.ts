import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../../../__tests__/fixtures'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { applyHttpTrace } = await import('../buildAgentParams')

describe('applyHttpTrace', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('does nothing when developer mode is disabled', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', false)
    const customFetch = vi.fn()
    const sdkConfig = { providerSettings: { fetch: customFetch } } as any

    applyHttpTrace(sdkConfig, 'topic-1', makeModel())

    // Untouched — the original fetch is left in place.
    expect(sdkConfig.providerSettings.fetch).toBe(customFetch)
  })

  it('wraps the provider fetch when developer mode is enabled, preserving the original as inner fetch', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
    const customFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const sdkConfig = { providerSettings: { fetch: customFetch } } as any

    applyHttpTrace(sdkConfig, 'topic-1', makeModel())

    // Replaced with a wrapper, not the original.
    expect(sdkConfig.providerSettings.fetch).not.toBe(customFetch)

    // Calling the wrapper still delegates to the original custom fetch.
    await sdkConfig.providerSettings.fetch('https://api.test/v1')
    expect(customFetch).toHaveBeenCalledWith('https://api.test/v1', undefined)
  })

  it('falls back to globalThis.fetch when the provider has no custom fetch', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
    const sdkConfig = { providerSettings: {} } as any

    applyHttpTrace(sdkConfig, 'topic-1', makeModel())

    expect(typeof sdkConfig.providerSettings.fetch).toBe('function')
  })
})
