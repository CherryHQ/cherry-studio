import { updateWebSearchProvider } from '@renderer/store/websearch'
import { describe, expect, it, vi } from 'vitest'

import { applyProviderApiKeySideEffects, applyProviderCustomHeaderSideEffects } from '../providerSettingsSideEffects'

describe('providerSettingsSideEffects', () => {
  it('syncs the first zhipu API key into legacy websearch state', () => {
    const dispatch = vi.fn()

    applyProviderApiKeySideEffects({
      providerId: 'zhipu',
      apiKey: 'sk-first,sk-second',
      dispatch: dispatch as never
    })

    expect(dispatch).toHaveBeenCalledWith(
      updateWebSearchProvider({
        id: 'zhipu',
        apiKey: 'sk-first'
      })
    )
  })

  it('does not touch legacy websearch state for other providers', () => {
    const dispatch = vi.fn()

    applyProviderApiKeySideEffects({
      providerId: 'openai',
      apiKey: 'sk-test',
      dispatch: dispatch as never
    })

    expect(dispatch).not.toHaveBeenCalled()
  })

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
