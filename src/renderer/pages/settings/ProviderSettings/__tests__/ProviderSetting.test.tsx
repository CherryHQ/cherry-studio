import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderSetting from '../ProviderSetting'

const useProviderMock = vi.fn()
const useProviderApiKeyMock = vi.fn()
const useProviderOnboardingAutoEnableMock = vi.fn()

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light'
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../hooks/providerSetting/useProviderOnboardingAutoEnable', () => ({
  useProviderOnboardingAutoEnable: (...args: any[]) => useProviderOnboardingAutoEnableMock(...args)
}))

vi.mock('../hooks/providerSetting/useProviderApiKey', () => ({
  useProviderApiKey: (...args: any[]) => useProviderApiKeyMock(...args)
}))

vi.mock('../components/ProviderHeader', () => ({
  default: ({ providerId }: any) => <div>{`provider-header-${providerId}`}</div>
}))

vi.mock('../ConnectionSettings/AuthenticationSection', async () => {
  const { useAuthenticationApiKey } = await import('../hooks/providerSetting/useAuthenticationApiKey')

  function AuthenticationSectionMock({ providerId }: any) {
    const { inputApiKey } = useAuthenticationApiKey()
    return <div>{`authentication-section-${providerId}-${inputApiKey}`}</div>
  }

  return {
    default: AuthenticationSectionMock
  }
})

vi.mock('../ModelList', async () => {
  const { useAuthenticationApiKey } = await import('../hooks/providerSetting/useAuthenticationApiKey')

  function ModelListMock({ providerId }: any) {
    const { inputApiKey } = useAuthenticationApiKey()
    return <div>{`model-list-${providerId}-${inputApiKey}`}</div>
  }

  return {
    ModelList: ModelListMock,
    ModelListHealthProvider: ({ children }: any) => <>{children}</>
  }
})

describe('ProviderSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: true, name: 'openai' }
    })
    useProviderApiKeyMock.mockReturnValue({
      serverApiKey: 'server-key',
      inputApiKey: 'shared-draft-key',
      setInputApiKey: vi.fn(),
      hasPendingSync: true,
      commitInputApiKeyNow: vi.fn()
    })
  })

  it('shares one API-key draft between authentication and model settings', () => {
    render(<ProviderSetting providerId="openai" isOnboarding />)

    expect(screen.getByTestId('provider-detail-shell')).toBeInTheDocument()
    expect(screen.getByText('provider-header-openai')).toBeInTheDocument()
    expect(screen.getByText('authentication-section-openai-shared-draft-key')).toBeInTheDocument()
    expect(screen.getByText('model-list-openai-shared-draft-key')).toBeInTheDocument()
    expect(useProviderApiKeyMock).toHaveBeenCalledTimes(1)
    expect(useProviderApiKeyMock).toHaveBeenCalledWith('openai')
    expect(useProviderOnboardingAutoEnableMock).toHaveBeenCalledWith({
      providerId: 'openai',
      isOnboarding: true
    })
  })

  it('renders nothing when the provider is missing', () => {
    useProviderMock.mockReturnValue({
      provider: undefined
    })

    const { container } = render(<ProviderSetting providerId="missing" />)

    expect(container).toBeEmptyDOMElement()
    expect(useProviderApiKeyMock).not.toHaveBeenCalled()
  })
})
