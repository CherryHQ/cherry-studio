import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiHost from '../ApiHost'

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
    InputGroupAddon: ({ children }: any) => <div>{children}</div>,
    InputGroupButton: ({ children, onClick, ...props }: any) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    ),
    InputGroupInput: ({ onChange, onBlur, ...props }: any) => <input onChange={onChange} onBlur={onBlur} {...props} />,
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

vi.mock('@renderer/pages/settings/ProviderSettingsV2/CherryINSettings', () => ({
  default: () => <div>cherry-in-settings</div>
}))

vi.mock('../ProviderCustomHeaderDrawer', () => ({
  default: ({ open }: any) => (open ? <div>custom-header-drawer</div> : null)
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

vi.mock('../ProviderField', () => ({
  default: ({ title, help, action, children, className }: any) => (
    <div className={className}>
      <div>{title}</div>
      {action}
      {help}
      {children}
    </div>
  )
}))

vi.mock('../ProviderSection', () => ({
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

  const baseProps = {
    providerId: 'openai'
  }

  const endpointState = {
    primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    apiHost: 'https://api.example.com',
    setApiHost: vi.fn(),
    anthropicApiHost: 'https://anthropic.example.com',
    setAnthropicApiHost: vi.fn(),
    apiVersion: '2024-01-01',
    setApiVersion: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('derives preview state locally and uses local endpoint actions for commit/reset', () => {
    const commitApiHost = vi.fn()
    const resetApiHost = vi.fn()

    useProviderHostPreviewMock.mockReturnValue({
      hostPreview: 'https://api.example.com/chat/completions',
      anthropicHostPreview: 'https://api.example.com/messages',
      isApiHostResettable: true
    })
    useProviderEndpointActionsMock.mockReturnValue({
      commitApiHost,
      commitAnthropicApiHost: vi.fn(),
      commitApiVersion: vi.fn(),
      resetApiHost
    })

    render(<ApiHost {...baseProps} />)

    expect(useProviderEndpointsMock).toHaveBeenCalledWith(provider)
    expect(useProviderHostPreviewMock).toHaveBeenCalledWith({
      provider,
      apiHost: endpointState.apiHost,
      anthropicApiHost: endpointState.anthropicApiHost
    })
    expect(useProviderEndpointActionsMock).toHaveBeenCalledWith({
      provider,
      primaryEndpoint: 'openai-chat-completions',
      apiHost: endpointState.apiHost,
      setApiHost: endpointState.setApiHost,
      providerApiHost: '',
      anthropicApiHost: endpointState.anthropicApiHost,
      setAnthropicApiHost: endpointState.setAnthropicApiHost,
      apiVersion: endpointState.apiVersion,
      patchProvider: updateProviderMock,
      syncProviderModels: syncProviderModelsMock
    })

    fireEvent.blur(screen.getByDisplayValue('https://api.example.com'))
    expect(commitApiHost).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(resetApiHost).toHaveBeenCalled()
  })

  it('opens the custom header drawer locally', () => {
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

    const { container } = render(<ApiHost {...baseProps} />)
    const settingsButton = container.querySelector('button')

    expect(settingsButton).not.toBeNull()
    fireEvent.click(settingsButton!)

    expect(screen.getByText('custom-header-drawer')).toBeInTheDocument()
  })

  it('shows the anthropic host field when anthropic is the default endpoint', () => {
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

    render(<ApiHost {...baseProps} />)

    expect(screen.getByDisplayValue('https://anthropic.example.com')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('https://api.example.com')).not.toBeInTheDocument()
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

    const { container } = render(<ApiHost {...baseProps} />)

    expect(container).toBeEmptyDOMElement()
  })
})
