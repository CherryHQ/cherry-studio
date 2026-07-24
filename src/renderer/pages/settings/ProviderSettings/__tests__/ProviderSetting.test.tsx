import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderSetting from '../ProviderSetting'

const useProviderMock = vi.fn()
const useProviderOnboardingAutoEnableMock = vi.fn()
const openHealthCheckMock = vi.fn()
const authenticationSectionPropsSpy = vi.fn()
const modelListPropsSpy = vi.fn()

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
    return (
      <div>
        {`authentication-section-${props.providerId}`}
        <button
          type="button"
          onClick={() => props.onConnectionModelDetection?.({ intent: 'detect', shouldGuideExistingModels: true })}>
          emit-connection-change
        </button>
      </div>
    )
  }
}))

vi.mock('../ModelList', () => ({
  ModelList: (props: any) => {
    modelListPropsSpy(props)
    return <div>{`model-list-${props.providerId}`}</div>
  },
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

  it('keeps the provider detail shell transparent so the settings background is continuous', () => {
    render(<ProviderSetting providerId="openai" />)

    expect(screen.getByTestId('provider-detail-shell')).not.toHaveClass('bg-background')
    expect(screen.getByTestId('provider-detail-shell')).not.toHaveClass('bg-card')
  })

  it('forwards connection-field events to the model list as versioned signals', () => {
    render(<ProviderSetting providerId="openai" />)

    fireEvent.click(screen.getByRole('button', { name: 'emit-connection-change' }))

    expect(modelListPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connectionModelDetectionSignal: {
          intent: 'detect',
          shouldGuideExistingModels: true,
          version: 1
        }
      })
    )
  })

  it('renders the provider detail divider below the provider header, aligned to body content width', () => {
    render(<ProviderSetting providerId="openai" />)

    const innerWrap = screen.getByText('provider-header-openai').parentElement as HTMLElement
    expect(innerWrap.className).toMatch(/(^|\s)border-b(\s|$)/)
    expect(innerWrap.className).toMatch(/(^|\s)max-w-3xl(\s|$)/)
    expect(innerWrap.className).toMatch(/(^|\s)mx-auto(\s|$)/)
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
