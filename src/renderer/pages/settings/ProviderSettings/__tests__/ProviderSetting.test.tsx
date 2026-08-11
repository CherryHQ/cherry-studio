import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderSetting from '../ProviderSetting'

const useProviderMock = vi.fn()
const useProviderOnboardingAutoEnableMock = vi.fn()
const openHealthCheckMock = vi.fn()
const authenticationSectionPropsSpy = vi.fn()

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

vi.mock('../components/ProviderHeader', () => ({
  default: ({ providerId }: any) => <div>{`provider-header-${providerId}`}</div>
}))

vi.mock('../ConnectionSettings/AuthenticationSection', () => ({
  default: (props: any) => {
    authenticationSectionPropsSpy(props)
    return <div>{`authentication-section-${props.providerId}`}</div>
  }
}))

vi.mock('../ModelList', () => ({
  ModelList: ({ providerId }: any) => <div>{`model-list-${providerId}`}</div>,
  ModelListHealthProvider: ({ children }: any) => <>{children}</>,
  useModelListHealth: () => ({
    openHealthCheck: openHealthCheckMock
  })
}))

describe('ProviderSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: true, name: 'openai' }
    })
  })

  it('keeps onboarding coordination at the page boundary', () => {
    render(<ProviderSetting providerId="openai" isOnboarding />)

    expect(screen.getByTestId('provider-detail-shell')).toBeInTheDocument()
    expect(screen.getByText('provider-header-openai')).toBeInTheDocument()
    expect(screen.getByText('authentication-section-openai')).toBeInTheDocument()
    expect(screen.getByText('model-list-openai')).toBeInTheDocument()
    expect(authenticationSectionPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        onOpenModelHealthCheck: openHealthCheckMock
      })
    )
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
  })
})
