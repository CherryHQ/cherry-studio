import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../../../__tests__/fixtures'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { httpTraceBaseFetch } = await import('../buildAgentParams')

describe('httpTraceBaseFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('installs no trace fetch when developer mode is disabled', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', false)

    // undefined leaves the provider config on its own proxy-aware default.
    expect(httpTraceBaseFetch('topic-1', makeModel())).toBeUndefined()
  })

  it('traces on top of customFetch when developer mode is enabled', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
    vi.mocked(net.fetch).mockResolvedValue(new Response(null, { status: 204 }))

    const traced = httpTraceBaseFetch('topic-1', makeModel())
    await traced?.('https://api.test/v1/responses', { method: 'POST', body: '{}' })

    // Chromium's proxy-aware net.fetch stays underneath the trace — the tracing
    // layer must not swap the transport for globalThis.fetch.
    expect(net.fetch).toHaveBeenCalled()
  })
})
