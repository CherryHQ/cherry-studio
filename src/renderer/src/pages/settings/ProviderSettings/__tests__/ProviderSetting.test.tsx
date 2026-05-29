import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderSetting from '../ProviderSetting'

const useProviderMock = vi.fn()
const useProviderAutoModelSyncMock = vi.fn()
const useProviderOnboardingAutoEnableMock = vi.fn()
const useProviderLegacyWebSearchSyncMock = vi.fn()

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({
    theme: 'light'
  })
}))

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../hooks/providerSetting/useProviderAutoModelSync', () => ({
  useProviderAutoModelSync: (...args: any[]) => useProviderAutoModelSyncMock(...args)
}))

vi.mock('../hooks/providerSetting/useProviderOnboardingAutoEnable', () => ({
  useProviderOnboardingAutoEnable: (...args: any[]) => useProviderOnboardingAutoEnableMock(...args)
}))

vi.mock('../hooks/providerSetting/useProviderLegacyWebSearchSync', () => ({
  useProviderLegacyWebSearchSync: (...args: any[]) => useProviderLegacyWebSearchSyncMock(...args)
}))

vi.mock('../components/ProviderHeader', () => ({
  default: ({ providerId }: any) => <div>{`provider-header-${providerId}`}</div>
}))

vi.mock('../ConnectionSettings/AuthenticationSection', () => ({
  default: ({ providerId }: any) => <div>{`authentication-section-${providerId}`}</div>
}))

vi.mock('../ModelList', () => ({
  ModelList: ({ providerId }: any) => <div>{`model-list-${providerId}`}</div>
}))

describe('ProviderSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: true, name: 'openai' }
    })
  })

  it('renders header, authentication section, and model list', () => {
    render(<ProviderSetting providerId="openai" />)

    expect(screen.getByTestId('provider-detail-shell')).toBeInTheDocument()
    expect(screen.getByText('provider-header-openai')).toBeInTheDocument()
    expect(screen.getByText('authentication-section-openai')).toBeInTheDocument()
    expect(screen.getByText('model-list-openai')).toBeInTheDocument()
  })

  it('keeps page-level coordination hooks at the page boundary', () => {
    render(<ProviderSetting providerId="openai" isOnboarding />)

    expect(useProviderAutoModelSyncMock).toHaveBeenCalledWith('openai')
    expect(useProviderOnboardingAutoEnableMock).toHaveBeenCalledWith({
      providerId: 'openai',
      isOnboarding: true
    })
    expect(useProviderLegacyWebSearchSyncMock).toHaveBeenCalledWith('openai')
  })

  it('renders nothing when the provider is missing', () => {
    useProviderMock.mockReturnValue({
      provider: undefined
    })

    const { container } = render(<ProviderSetting providerId="missing" />)

    expect(container).toBeEmptyDOMElement()
  })
})
