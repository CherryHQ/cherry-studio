import AuthenticationSection from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/AuthenticationSection'
import { ApiKeyProvider } from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useAuthenticationApiKey'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useProviderMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../../ConnectionSettings/ApiKey', async () => {
  const { useAuthenticationApiKey } = await import('../../hooks/providerSetting/useAuthenticationApiKey')

  function ApiKeyMock({ providerId }: any) {
    const { inputApiKey } = useAuthenticationApiKey()
    return <div>{`api-key-${providerId}-${inputApiKey}`}</div>
  }

  return {
    default: ApiKeyMock
  }
})

vi.mock('../../ConnectionSettings/ApiHost', () => ({
  default: ({ providerId }: any) => <div>{`api-host-${providerId}`}</div>
}))

vi.mock('../../ProviderSpecific/ProviderSpecificSettings', () => ({
  default: ({ placement }: any) => <div>{`provider-specific-${placement}`}</div>
}))

describe('AuthenticationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: true, name: 'openai' }
    })
  })

  it('uses the API-key state owned by the provider page', () => {
    const apiKey = {
      serverApiKey: 'shared-server-key',
      inputApiKey: 'shared-draft-key',
      setInputApiKey: vi.fn(),
      hasPendingSync: true,
      commitInputApiKeyNow: vi.fn()
    }

    render(
      <ApiKeyProvider value={apiKey}>
        <AuthenticationSection providerId="openai" />
      </ApiKeyProvider>
    )

    expect(screen.getByText('api-key-openai-shared-draft-key')).toBeInTheDocument()
    expect(screen.getByText('api-host-openai')).toBeInTheDocument()
  })
})
