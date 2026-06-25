import { describe, expect, it, vi } from 'vitest'

import { applyProviderCustomHeaderSideEffects } from './providerSettingsSideEffects'

describe('providerSettingsSideEffects', () => {
  it('syncs copilot custom headers into the legacy store adapter', () => {
    const updateCopilotHeaders = vi.fn()

    applyProviderCustomHeaderSideEffects({
      providerId: 'copilot',
      headers: { Authorization: 'Bearer token' },
      updateCopilotHeaders
    })

    expect(updateCopilotHeaders).toHaveBeenCalledWith({ Authorization: 'Bearer token' })
  })

  it('does not sync custom headers for non-copilot providers', () => {
    const updateCopilotHeaders = vi.fn()

    applyProviderCustomHeaderSideEffects({
      providerId: 'openai',
      headers: { Authorization: 'Bearer token' },
      updateCopilotHeaders
    })

    expect(updateCopilotHeaders).not.toHaveBeenCalled()
  })
})
