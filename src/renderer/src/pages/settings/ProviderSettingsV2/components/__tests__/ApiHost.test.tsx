import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { fireEvent, render, screen } from '@testing-library/react'
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

vi.mock('@renderer/pages/settings/ProviderSettingsV2/ProviderSpecific/CherryINSettings', () => ({
  default: () => <div>cherry-in-settings</div>
}))

vi.mock('../../ConnectionSettings/ProviderCustomHeaderDrawer', () => ({
  default: ({
    providerId,
    open,
    hostEditMode,
    commitApiHost,
    commitAnthropicApiHost,
    anthropicApiHost,
    apiHost
  }: any) =>
    open ? (
      <div data-testid="request-config-drawer" data-provider={providerId} data-mode={hostEditMode}>
        <span>{`host-edit:${hostEditMode}:${hostEditMode === 'anthropic' ? anthropicApiHost : apiHost}`}</span>
        <button
          type="button"
          onClick={() =>
            hostEditMode === 'anthropic'
              ? commitAnthropicApiHost('https://anthropic-drawer.example')
              : commitApiHost('https://drawer-commit.example')
          }
          data-testid="drawer-commit-host">
          commit-host
        </button>
      </div>
    ) : null
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

vi.mock('../../shared/primitives/ProviderField', () => ({
  default: ({ title, help, children, className }: any) => (
    <div className={className}>
      <div>{title}</div>
      {help}
      {children}
    </div>
  )
}))

vi.mock('../../shared/primitives/ProviderSection', () => ({
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

  it('commits host from the request-configuration drawer and resets the primary API host from the connection row', () => {
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

    render(<ApiHost providerId="openai" />)

    /** `settings.provider.api.url.reset`: en-US "Reset", zh-CN "重置" */
    fireEvent.click(screen.getByRole('button', { name: /^重置$|^Reset$/ }))
    expect(resetApiHost).toHaveBeenCalled()

    /** `settings.provider.request_configuration_tooltip`: bilingual label on the config trigger */
    fireEvent.click(screen.getByRole('button', { name: /Configure API Host|配置 API Host/i }))

    expect(screen.getByTestId('request-config-drawer')).toHaveAttribute('data-mode', 'primary')

    fireEvent.click(screen.getByTestId('drawer-commit-host'))
    expect(commitApiHost).toHaveBeenCalledWith('https://drawer-commit.example')
  })

  it('uses anthropic drawer mode when anthropic messaging is the primary endpoint', () => {
    const anthropicCommit = vi.fn()

    useProviderHostPreviewMock.mockReturnValue({
      hostPreview: 'https://api.example.com/chat/completions',
      anthropicHostPreview: 'https://anthropic.example.com/messages',
      isApiHostResettable: false
    })
    useProviderEndpointActionsMock.mockReturnValue({
      commitApiHost: vi.fn(),
      commitAnthropicApiHost: anthropicCommit,
      commitApiVersion: vi.fn(),
      resetApiHost: vi.fn()
    })

    useProviderEndpointsMock.mockReturnValue({
      ...endpointState,
      primaryEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    })

    render(<ApiHost providerId="openai" />)

    fireEvent.click(screen.getByRole('button', { name: /Configure API Host|配置 API Host/i }))

    const drawer = screen.getByTestId('request-config-drawer')
    expect(drawer).toHaveAttribute('data-mode', 'anthropic')
    expect(drawer.textContent).toContain(endpointState.anthropicApiHost)

    fireEvent.click(screen.getByTestId('drawer-commit-host'))
    expect(anthropicCommit).toHaveBeenCalledWith('https://anthropic-drawer.example')
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
