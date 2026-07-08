import ApiHost from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/ApiHost'
import { toast } from '@renderer/services/toast'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useProviderMock = vi.fn()
const useProviderMutationsMock = vi.fn()
const useProviderEndpointsMock = vi.fn()
const useProviderMetaMock = vi.fn()
const useProviderHostPreviewMock = vi.fn()
const useProviderEndpointActionsMock = vi.fn()
const updateProviderMock = vi.fn()

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<any>()

  return {
    ...actual,
    HelpTooltip: ({ title }: any) => <span>{title}</span>,
    InputGroup: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

vi.mock('@renderer/pages/settings/ProviderSettings/ProviderSpecific/CherryInSettings', () => ({
  default: () => <div>cherry-in-settings</div>
}))

vi.mock('../../ConnectionSettings/ProviderCustomHeaderDrawer', () => ({
  default: ({ providerId, open }: any) =>
    open ? <div data-testid="request-config-drawer" data-provider={providerId} /> : null
}))

vi.mock('@renderer/hooks/useProvider', () => ({
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

vi.mock('../../primitives/ProviderField', () => ({
  default: ({ title, action, help, children, className }: any) => (
    <div className={className}>
      <div>
        {title}
        {action}
      </div>
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
    useProviderMock.mockReturnValue({ provider })
    useProviderMutationsMock.mockReturnValue({ updateProvider: updateProviderMock })
    useProviderEndpointsMock.mockReturnValue(endpointState)
    useProviderMetaMock.mockReturnValue({
      isConnectionFieldVisible: true,
      isAzureOpenAI: false,
      isCherryIN: false,
      isChineseUser: false
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
      expect(toast.success).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('request-config-drawer')).not.toBeInTheDocument()
  })

  it('edits the primary API host and commits it without opening the request-configuration drawer', () => {
    const commitApiHost = vi.fn()

    useProviderHostPreviewMock.mockReturnValue({
      hostPreview: 'https://api.example.com/chat/completions',
      anthropicHostPreview: 'https://api.example.com/messages',
      isApiHostResettable: false
    })
    useProviderEndpointActionsMock.mockReturnValue({
      commitApiHost,
      commitAnthropicApiHost: vi.fn(),
      commitApiVersion: vi.fn(),
      resetApiHost: vi.fn()
    })

    render(<ApiHost providerId="openai" />)

    const apiHostInput = screen.getByRole('textbox', { name: /^API 地址$|^API Host$/ })
    fireEvent.click(apiHostInput)
    fireEvent.change(apiHostInput, { target: { value: 'https://api2.example.com' } })
    fireEvent.blur(apiHostInput)

    expect(endpointState.setApiHost).toHaveBeenCalledWith('https://api2.example.com')
    expect(commitApiHost).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('request-config-drawer')).not.toBeInTheDocument()
  })

  it('opens the request-configuration drawer from the add endpoint text button', () => {
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

    expect(screen.queryByTestId('request-config-drawer')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^添加端点$|^Add Endpoint$/i }))
    expect(screen.getByTestId('request-config-drawer')).toHaveAttribute('data-provider', 'openai')
  })

  it('opens the request-configuration drawer from the add endpoint text button when multiple endpoints exist', () => {
    const resetApiHost = vi.fn()

    useProviderMock.mockReturnValue({
      provider: {
        ...provider,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com' },
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://anthropic.example.com' }
        }
      }
    })
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

    const addEndpointButton = screen.getByRole('button', { name: /^添加端点$|^Add Endpoint$/i })
    expect(addEndpointButton).toHaveTextContent(/^添加端点$|^Add Endpoint$/i)
    expect(addEndpointButton).toHaveClass('font-normal')
    fireEvent.click(addEndpointButton)

    expect(screen.getByTestId('request-config-drawer')).toHaveAttribute('data-provider', 'openai')
  })

  it('edits the anthropic API host and opens the drawer from the add endpoint text button', () => {
    const commitAnthropicApiHost = vi.fn()

    useProviderMock.mockReturnValue({
      provider: {
        ...provider,
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://anthropic.example.com' },
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com' }
        }
      }
    })
    useProviderHostPreviewMock.mockReturnValue({
      hostPreview: 'https://api.example.com/chat/completions',
      anthropicHostPreview: 'https://anthropic.example.com/messages',
      isApiHostResettable: false
    })
    useProviderEndpointActionsMock.mockReturnValue({
      commitApiHost: vi.fn(),
      commitAnthropicApiHost,
      commitApiVersion: vi.fn(),
      resetApiHost: vi.fn()
    })

    useProviderEndpointsMock.mockReturnValue({
      ...endpointState,
      primaryEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    })

    render(<ApiHost providerId="openai" />)

    const anthropicHostInput = screen.getByRole('textbox', { name: /^Anthropic API 地址$|^Anthropic API Host$/ })
    fireEvent.change(anthropicHostInput, { target: { value: 'https://anthropic2.example.com' } })
    fireEvent.blur(anthropicHostInput)
    expect(endpointState.setAnthropicApiHost).toHaveBeenCalledWith('https://anthropic2.example.com')
    expect(commitAnthropicApiHost).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('request-config-drawer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^添加端点$|^Add Endpoint$/i }))

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
