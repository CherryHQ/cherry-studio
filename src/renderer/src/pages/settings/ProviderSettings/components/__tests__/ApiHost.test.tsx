import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiHost from '../../ConnectionSettings/ApiHost'

const useProviderMock = vi.fn()
const useProviderMutationsMock = vi.fn()
const useProviderEndpointsMock = vi.fn()
const useProviderMetaMock = vi.fn()
const useProviderModelSyncMock = vi.fn()
const useProviderHostPreviewMock = vi.fn()
const useProviderEndpointActionsMock = vi.fn()
const updateProviderMock = vi.fn()
const syncProviderModelsMock = vi.fn()

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<any>()

  return {
    ...actual,
    HelpTooltip: ({ title }: any) => <span>{title}</span>,
    InputGroup: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

vi.mock('@renderer/pages/settings/ProviderSettings/ProviderSpecific/CherryINSettings', () => ({
  default: () => <div>cherry-in-settings</div>
}))

vi.mock('../../ConnectionSettings/ProviderCustomHeaderDrawer', () => ({
  default: ({ providerId, open }: any) =>
    open ? <div data-testid="request-config-drawer" data-provider={providerId} /> : null
}))

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderMutations: (...args: any[]) => useProviderMutationsMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderHostPreview', () => ({
  useProviderHostPreview: (...args: any[]) => useProviderHostPreviewMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderEndpoints', () => ({
  useProviderEndpoints: (...args: any[]) => useProviderEndpointsMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderMeta', () => ({
  useProviderMeta: (...args: any[]) => useProviderMetaMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderEndpointActions', () => ({
  useProviderEndpointActions: (...args: any[]) => useProviderEndpointActionsMock(...args)
}))

vi.mock('../../hooks/useProviderModelSync', () => ({
  useProviderModelSync: (...args: any[]) => useProviderModelSyncMock(...args)
}))

vi.mock('../../primitives/ProviderField', () => ({
  default: ({ title, help, children, className }: any) => (
    <div className={className}>
      <div>{title}</div>
      {help}
      {children}
    </div>
  )
}))

vi.mock('../../primitives/ProviderSection', () => ({
  default: ({ children }: any) => <section>{children}</section>
}))

describe('ApiHost', () => {
  const provider = {
    id: 'openai',
    name: 'OpenAI',
    isEnabled: true,
    endpointConfigs: {},
    settings: {}
  } as any

  const endpointState = {
    primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    apiHost: 'https://api.example.com',
    setApiHost: vi.fn(),
    anthropicApiHost: 'https://anthropic.example.com',
    setAnthropicApiHost: vi.fn(),
    apiVersion: '2024-01-01',
    setApiVersion: vi.fn(),
    isVertexProvider: false
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
    window.toast = {
      success: vi.fn(),
      error: vi.fn()
    } as unknown as typeof window.toast
    useProviderMock.mockReturnValue({ provider })
    useProviderMutationsMock.mockReturnValue({ updateProvider: updateProviderMock })
    useProviderEndpointsMock.mockReturnValue(endpointState)
    useProviderMetaMock.mockReturnValue({
      isConnectionFieldVisible: true,
      isAzureOpenAI: false,
      isCherryIN: false,
      isChineseUser: false
    })
    useProviderModelSyncMock.mockReturnValue({
      syncProviderModels: syncProviderModelsMock
    })
  })

  it('copies the api host from the hover action and shows copied feedback', async () => {
    useProviderHostPreviewMock.mockReturnValue({
      hostPreview: 'https://api.example.com/chat/completions',
      anthropicHostPreview: 'https://api.example.com/messages',
      isApiHostResettable: false
    })
    useProviderEndpointActionsMock.mockReturnValue({
      commitApiHost: vi.fn(),
      commitAnthropicApiHost: vi.fn(),
      commitApiVersion: vi.fn(),
      resetApiHost: vi.fn()
    })

    render(<ApiHost providerId="openai" />)

    fireEvent.click(screen.getByRole('button', { name: /^复制$|^Copy$/ }))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://api.example.com')
      expect(window.toast.success).toHaveBeenCalled()
    })
  })

  it('opens the request-configuration drawer and resets the primary API host from the connection row', () => {
    const resetApiHost = vi.fn()

    useProviderHostPreviewMock.mockReturnValue({
      hostPreview: 'https://api.example.com/chat/completions',
      anthropicHostPreview: 'https://api.example.com/messages',
      isApiHostResettable: true
    })
    useProviderEndpointActionsMock.mockReturnValue({
      commitApiHost: vi.fn(),
      commitAnthropicApiHost: vi.fn(),
      commitApiVersion: vi.fn(),
      resetApiHost
    })

    render(<ApiHost providerId="openai" />)

    /** `settings.provider.api.url.reset`: en-US "Reset", zh-CN "重置" */
    fireEvent.click(screen.getByRole('button', { name: /^重置$|^Reset$/ }))
    expect(resetApiHost).toHaveBeenCalled()

    /** `settings.provider.request_configuration_tooltip`: bilingual label on the config trigger */
    fireEvent.click(screen.getByRole('button', { name: /Configure API Host|配置 API Host/i }))

    expect(screen.getByTestId('request-config-drawer')).toHaveAttribute('data-provider', 'openai')
  })

  it('opens the drawer when anthropic messaging is the primary endpoint', () => {
    useProviderHostPreviewMock.mockReturnValue({
      hostPreview: 'https://api.example.com/chat/completions',
      anthropicHostPreview: 'https://anthropic.example.com/messages',
      isApiHostResettable: false
    })
    useProviderEndpointActionsMock.mockReturnValue({
      commitApiHost: vi.fn(),
      commitAnthropicApiHost: vi.fn(),
      commitApiVersion: vi.fn(),
      resetApiHost: vi.fn()
    })

    useProviderEndpointsMock.mockReturnValue({
      ...endpointState,
      primaryEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    })

    render(<ApiHost providerId="openai" />)

    fireEvent.click(screen.getByRole('button', { name: /Configure API Host|配置 API Host/i }))

    expect(screen.getByTestId('request-config-drawer')).toHaveAttribute('data-provider', 'openai')
  })

  it('returns no connection field when the provider hides connection settings', () => {
    useProviderMock.mockReturnValue({
      provider: {
        ...provider,
        id: 'aws-bedrock',
        name: 'AWS Bedrock'
      }
    })
    useProviderMetaMock.mockReturnValue({
      isConnectionFieldVisible: false,
      isAzureOpenAI: false,
      isCherryIN: false,
      isChineseUser: false
    })
    useProviderHostPreviewMock.mockReturnValue({
      hostPreview: '',
      anthropicHostPreview: '',
      isApiHostResettable: false
    })
    useProviderEndpointActionsMock.mockReturnValue({
      commitApiHost: vi.fn(),
      commitAnthropicApiHost: vi.fn(),
      commitApiVersion: vi.fn(),
      resetApiHost: vi.fn()
    })

    const { container } = render(<ApiHost providerId="aws-bedrock" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the provider is missing', () => {
    useProviderMock.mockReturnValue({ provider: undefined })

    const { container } = render(<ApiHost providerId="openai" />)

    expect(container).toBeEmptyDOMElement()
  })
})
