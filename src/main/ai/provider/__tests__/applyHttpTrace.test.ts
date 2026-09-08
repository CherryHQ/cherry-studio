import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../__tests__/fixtures/model'
import type { ProviderConfig } from '../../types'
import { applyHttpTrace } from '../applyHttpTrace'

describe('applyHttpTrace', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
  })
  afterEach(() => vi.restoreAllMocks())

  it('does nothing when developer mode is disabled', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', false)
    const customFetch = vi.fn()
    const sdkConfig: Pick<ProviderConfig, 'providerSettings'> = { providerSettings: { fetch: customFetch } }

    applyHttpTrace(sdkConfig, 'topic-1', makeModel())

    // Untouched — the original fetch is left in place.
    expect(sdkConfig.providerSettings.fetch).toBe(customFetch)
  })

  it('wraps the provider fetch when developer mode is enabled, preserving the original as inner fetch', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
    const customFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const sdkConfig: Pick<ProviderConfig, 'providerSettings'> = { providerSettings: { fetch: customFetch } }

    applyHttpTrace(sdkConfig, 'topic-1', makeModel())

    // Replaced with a wrapper, not the original.
    expect(sdkConfig.providerSettings.fetch).not.toBe(customFetch)

    // Calling the wrapper still delegates to the original custom fetch.
    if (!sdkConfig.providerSettings.fetch) throw new Error('Missing traced fetch')
    await sdkConfig.providerSettings.fetch('https://api.test/v1')
    expect(customFetch).toHaveBeenCalledWith('https://api.test/v1', undefined)
  })

  it('uses the app proxy transport when no fetch wrapper was supplied', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
    const sdkConfig: Pick<ProviderConfig, 'providerSettings'> = { providerSettings: {} }
    vi.mocked(net.fetch).mockResolvedValue(new Response('proxy response'))
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('proxy bypass'))

    applyHttpTrace(sdkConfig, 'topic-1', makeModel())

    if (!sdkConfig.providerSettings.fetch) throw new Error('Missing traced fetch')
    const response = await sdkConfig.providerSettings.fetch('https://api.test/v1')
    expect(await response.text()).toBe('proxy response')
    expect(globalFetch).not.toHaveBeenCalled()
  })
})
