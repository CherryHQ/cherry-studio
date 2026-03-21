import type { ReactNode } from 'react'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderOAuth from '../ProviderOAuth'

const mocks = vi.hoisted(() => ({
  provider: {
    id: 'poe',
    type: 'openai',
    name: 'Poe',
    apiKey: '',
    apiHost: 'https://api.poe.com',
    models: []
  } as any,
  updateProvider: vi.fn(),
  authHandler: vi.fn(),
  oauthButtonResult: { apiKey: '  poe-api-key  ', apiKeyExpiresAt: 1234 },
  t: vi.fn((key: string, values?: Record<string, string>) => {
    const translations: Record<string, string> = {
      'settings.provider.oauth.connected': 'Connected',
      'settings.provider.oauth.reconnect': 'Reconnect',
      'settings.provider.oauth.open_api_keys': 'Open API Keys',
      'settings.provider.oauth.open_provider_website': 'Open Provider Website',
      'settings.provider.charge': 'Charge',
      'settings.provider.bills': 'Bills',
      'settings.provider.oauth.error': 'OAuth failed',
      'auth.get_key_success': 'Key added'
    }

    if (key === 'settings.provider.oauth.button') {
      return `Login with ${values?.provider || 'Provider'}`
    }

    return translations[key] || key
  })
}))

vi.mock('@renderer/components/Layout', () => ({
  HStack: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/OAuth/OAuthButton', () => ({
  default: ({ children, onSuccess }: { children: ReactNode; onSuccess?: (result: any) => void }) => (
    <button type="button" onClick={() => onSuccess?.(mocks.oauthButtonResult)}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/config/providers', () => ({
  PROVIDER_CONFIG: {
    poe: {
      api: { url: 'https://api.poe.com' },
      websites: {
        official: 'https://poe.com',
        apiKey: 'https://poe.com/api_key'
      }
    }
  },
  getProviderLogo: () => 'poe-logo.png'
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({
    provider: mocks.provider,
    updateProvider: mocks.updateProvider
  })
}))

vi.mock('@renderer/i18n/label', () => ({
  getProviderLabel: () => 'Poe'
}))

vi.mock('@renderer/services/ProviderService', () => ({
  getProviderAuthHandler: () => mocks.authHandler,
  getProviderOAuthActions: () => ['apiKey']
}))

vi.mock('@renderer/utils/oauth', () => ({
  providerBills: vi.fn(),
  providerCharge: vi.fn()
}))

vi.mock('antd', () => ({
  Alert: ({ message, description, action }: any) => (
    <div>
      <div>{message}</div>
      <div>{description}</div>
      {action}
    </div>
  ),
  Button: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  )
}))

vi.mock('react-i18next', () => ({
  Trans: ({ values }: { values?: Record<string, string> }) => <span>{values?.provider}</span>,
  useTranslation: () => ({ t: mocks.t })
}))

describe('ProviderOAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.provider = {
      id: 'poe',
      type: 'openai',
      name: 'Poe',
      apiKey: '',
      apiHost: 'https://api.poe.com',
      models: []
    }
    mocks.oauthButtonResult = { apiKey: '  poe-api-key  ', apiKeyExpiresAt: 1234 }
    window.open = vi.fn()
    window.message = {
      success: vi.fn(),
      error: vi.fn()
    } as any
  })

  it('updates the provider state after a successful Poe login', async () => {
    const user = userEvent.setup()

    render(<ProviderOAuth providerId="poe" />)

    await user.click(screen.getByRole('button', { name: 'Login with Poe' }))

    expect(mocks.updateProvider).toHaveBeenCalledWith({
      apiKey: 'poe-api-key',
      apiKeyExpiresAt: 1234
    })
  })

  it('shows error feedback when Poe reconnect fails', async () => {
    const user = userEvent.setup()

    mocks.provider = {
      ...mocks.provider,
      apiKey: 'existing-poe-key',
      apiKeyExpiresAt: Date.now() + 3 * 24 * 60 * 60 * 1000
    }
    mocks.authHandler.mockRejectedValue(new Error('Poe reconnect failed'))

    render(<ProviderOAuth providerId="poe" />)

    await user.click(screen.getByRole('button', { name: 'Reconnect' }))

    expect(mocks.authHandler).toHaveBeenCalledTimes(1)
    expect(window.message.error).toHaveBeenCalledWith({ content: 'Poe reconnect failed', key: 'auth-error' })
  })

  it('renders the Poe post-auth connected state and actions', async () => {
    const user = userEvent.setup()

    mocks.provider = {
      ...mocks.provider,
      apiKey: 'existing-poe-key',
      apiKeyExpiresAt: Date.now() + 3 * 24 * 60 * 60 * 1000
    }

    render(<ProviderOAuth providerId="poe" />)

    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open API Keys' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open API Keys' }))

    expect(window.open).toHaveBeenCalledWith('https://poe.com/api_key', '_blank', 'noopener,noreferrer')
  })
})
