import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiHost from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/ApiHost'
import { toast } from '@renderer/services/toast'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

const useProviderMock = vi.fn()
const useProviderMutationsMock = vi.fn()
const useProviderPresetMock = vi.fn()
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
  useProviderMutations: (...args: any[]) => useProviderMutationsMock(...args),
  useProviderPreset: (...args: any[]) => useProviderPresetMock(...args)
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
    useProviderPresetMock.mockReturnValue({ data: undefined })
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
      isApiHostResettable: false
    })
    useProviderEndpointActionsMock.mockReturnValue({
      commitApiHost: vi.fn(),
      commitApiVersion: vi.fn(),
      resetApiHost: vi.fn()
    })

    render(<ApiHost providerId="openai" />)

    fireEvent.click(screen.getByRole('button', { name: /^复制$|^Copy$/ }))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://api.example.com')
      expect(toast.success).toHaveBeenCalled()
    })
  })
})
