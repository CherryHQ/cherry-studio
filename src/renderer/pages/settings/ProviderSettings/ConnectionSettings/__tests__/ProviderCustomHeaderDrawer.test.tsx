import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

const useProviderMock = vi.fn()
const updateProviderMock = vi.fn()
const syncProviderModelsMock = vi.fn()

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    Badge: ({ children, ...props }: any) => React.createElement('span', props, children),
    Button: ({ children, onClick, ...props }: any) =>
      React.createElement('button', { ...props, onClick, type: props.type ?? 'button' }, children),
    InputGroup: ({ children, ...props }: any) => React.createElement('div', props, children),
    InputGroupInput: (props: any) => React.createElement('input', props),
    Label: ({ children, ...props }: any) => React.createElement('label', props, children),
    MenuItem: ({ label, onClick }: any) => React.createElement('button', { onClick, type: 'button' }, label),
    MenuList: ({ children }: any) => React.createElement('div', null, children),
    Popover: ({ children }: any) => React.createElement('div', null, children),
    PopoverContent: ({ children }: any) => React.createElement('div', null, children),
    PopoverTrigger: ({ children }: any) => children,
    Tooltip: ({ children }: any) => children
  }
})

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../../components/ProviderImageEndpointFields', () => ({
  ProviderImageEndpointFields: () => null
}))

vi.mock('../../hooks/useProviderModelSync', () => ({
  useProviderModelSync: () => ({ syncProviderModels: syncProviderModelsMock })
}))

vi.mock('../../primitives/ProviderActions', () => ({
  default: ({ children }: any) => <div>{children}</div>
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ children, footer, open, title }: any) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null
}))

vi.mock('../../primitives/ProviderSettingsPrimitives', () => ({
  customHeaderDrawerClasses: {
    addRowButton: '',
    bodyScroll: '',
    headerList: '',
    headerRow: '',
    removeIconButton: ''
  },
  drawerClasses: { footer: '' },
  fieldClasses: { iconButton: '', input: '', inputGroup: '' }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

import ProviderCustomHeaderDrawer from '../ProviderCustomHeaderDrawer'

describe('ProviderCustomHeaderDrawer', () => {
  const provider = {
    id: 'custom-provider',
    name: 'Custom Provider',
    authType: 'api-key',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://openai.example.com' },
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://anthropic.example.com' }
    },
    settings: {}
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    updateProviderMock.mockResolvedValue(undefined)
    syncProviderModelsMock.mockResolvedValue([])
    useProviderMock.mockReturnValue({ provider, updateProvider: updateProviderMock })
  })

  it('persists a configured endpoint as the provider default', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<ProviderCustomHeaderDrawer providerId={provider.id} open onClose={onClose} />)

    expect(screen.getByText('settings.provider.create_custom.endpoint_fields.default_chat')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'settings.provider.create_custom.endpoint_fields.set_default_chat'
      })
    )
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(updateProviderMock).toHaveBeenCalledWith({
        endpointConfigs: provider.endpointConfigs,
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        providerSettings: { extraHeaders: {} }
      })
    })
    expect(syncProviderModelsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointConfigs: provider.endpointConfigs,
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      })
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
