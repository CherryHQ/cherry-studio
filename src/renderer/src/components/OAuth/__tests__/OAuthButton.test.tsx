import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import OAuthButton from '../OAuthButton'

const mocks = vi.hoisted(() => ({
  authHandler: vi.fn(),
  onSuccess: vi.fn(),
  t: vi.fn((key: string, values?: Record<string, string>) => {
    if (key === 'settings.provider.oauth.button') {
      return `Login with ${values?.provider || 'Provider'}`
    }

    if (key === 'auth.get_key_success') {
      return 'Key added'
    }

    if (key === 'settings.provider.oauth.error') {
      return 'OAuth failed'
    }

    return key
  })
}))

vi.mock('@renderer/i18n/label', () => ({
  getProviderLabel: () => 'Poe'
}))

vi.mock('@renderer/services/ProviderService', () => ({
  getProviderAuthHandler: () => mocks.authHandler
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t })
}))

describe('OAuthButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.message = {
      success: vi.fn(),
      error: vi.fn()
    } as any
  })

  it('dispatches Poe auth and forwards the returned result', async () => {
    const user = userEvent.setup()
    const provider = {
      id: 'poe',
      type: 'openai',
      name: 'Poe',
      apiKey: '',
      apiHost: 'https://api.poe.com',
      models: []
    } as any

    mocks.authHandler.mockResolvedValue({ apiKey: 'poe-api-key', apiKeyExpiresAt: 1234 })

    render(<OAuthButton provider={provider} onSuccess={mocks.onSuccess} />)

    await user.click(screen.getByRole('button', { name: 'Login with Poe' }))

    expect(mocks.authHandler).toHaveBeenCalledTimes(1)
    expect(mocks.authHandler).toHaveBeenCalledWith(expect.any(Function))
    expect(mocks.onSuccess).toHaveBeenCalledWith({ apiKey: 'poe-api-key', apiKeyExpiresAt: 1234 })
    expect(window.message.success).toHaveBeenCalledWith({ content: 'Key added', key: 'auth-success' })
  })
})
