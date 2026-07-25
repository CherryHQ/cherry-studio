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

  it('renders header, authentication section, and model list', () => {
    render(<ProviderSetting providerId="openai" />)

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
  })

  it('keeps ordinary provider authentication and model settings in separate groups', () => {
    render(<ProviderSetting providerId="openai" />)

    expect(screen.getByText('authentication-section-openai').parentElement).toHaveClass('rounded-xl', 'border', 'p-4')
    expect(screen.getByText('model-list-openai').parentElement).toHaveClass('rounded-xl', 'border', 'p-4')
  })

  it('renders a login alert without an extra group and tightens its surrounding spacing', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai-codex', isEnabled: true, name: 'OpenAI Codex', authMethods: ['oauth'] }
    })

    render(<ProviderSetting providerId="openai-codex" />)

    const authenticationWrapper = screen.getByText('authentication-section-openai-codex').parentElement as HTMLElement
    expect(authenticationWrapper).not.toHaveClass('rounded-xl', 'border', 'p-4')
    expect(authenticationWrapper.parentElement).toHaveClass('gap-3')
    expect(screen.getByText('model-list-openai-codex').parentElement).toHaveClass('rounded-xl', 'border', 'p-4')
  })

  it('keeps the provider detail shell transparent so the settings background is continuous', () => {
    render(<ProviderSetting providerId="openai" />)

    expect(screen.getByTestId('provider-detail-shell')).not.toHaveClass('bg-background')
    expect(screen.getByTestId('provider-detail-shell')).not.toHaveClass('bg-card')
  })

  it('aligns the provider header to the body without a divider and keeps its top spacing compact', () => {
    render(<ProviderSetting providerId="openai" />)

    const innerWrap = screen.getByText('provider-header-openai').parentElement as HTMLElement
    const bodyScroller = screen.getByText('authentication-section-openai').parentElement?.parentElement
      ?.parentElement as HTMLElement
    expect(innerWrap.className).not.toMatch(/(^|\s)border-b(\s|$)/)
    expect(innerWrap.className).toMatch(/(^|\s)max-w-3xl(\s|$)/)
    expect(innerWrap.className).toMatch(/(^|\s)mx-auto(\s|$)/)
    expect(innerWrap).toHaveClass('pb-1')
    expect(innerWrap.parentElement).toHaveClass('pt-4')
    expect(bodyScroller).toHaveClass('px-6', 'pt-3', 'pb-6')
  })

  it('keeps onboarding coordination at the page boundary', () => {
    render(<ProviderSetting providerId="openai" isOnboarding />)

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
