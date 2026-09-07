import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    Select: ({ children }: any) => React.createElement('div', null, children),
    SelectContent: ({ children }: any) => React.createElement('div', null, children),
    SelectItem: ({ children }: any) => React.createElement('div', null, children),
    SelectTrigger: ({ children, ...props }: any) => React.createElement('button', props, children),
    SelectValue: () => React.createElement('span', null, 'value'),
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
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && 'key' in params ? `${key} ${String(params.key)}` : key
  })
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

  it('persists clearing the last header as an explicit null merge-patch key', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    useProviderMock.mockReturnValue({
      provider: {
        ...provider,
        settings: { extraHeaders: { 'X-Only': 'a' } }
      },
      updateProvider: updateProviderMock
    })

    render(<ProviderCustomHeaderDrawer providerId={provider.id} open onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'settings.provider.delete.header X-Only' }))
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(updateProviderMock).toHaveBeenCalledWith({
        endpointConfigs: provider.endpointConfigs,
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        providerSettings: { extraHeaders: { 'X-Only': null } }
      })
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps surviving headers alongside the nulled key when deleting one of several', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    useProviderMock.mockReturnValue({
      provider: {
        ...provider,
        settings: { extraHeaders: { 'X-Keep': 'a', 'X-Remove': 'b' } }
      },
      updateProvider: updateProviderMock
    })

    render(<ProviderCustomHeaderDrawer providerId={provider.id} open onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'settings.provider.delete.header X-Remove' }))
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(updateProviderMock).toHaveBeenCalledWith({
        endpointConfigs: provider.endpointConfigs,
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        providerSettings: { extraHeaders: { 'X-Keep': 'a', 'X-Remove': null } }
      })
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('deletes a header named after an Object.prototype member', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    useProviderMock.mockReturnValue({
      provider: {
        ...provider,
        settings: { extraHeaders: { toString: 'a' } }
      },
      updateProvider: updateProviderMock
    })

    render(<ProviderCustomHeaderDrawer providerId={provider.id} open onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'settings.provider.delete.header toString' }))
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(updateProviderMock).toHaveBeenCalledWith({
        endpointConfigs: provider.endpointConfigs,
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        providerSettings: { extraHeaders: { toString: null } }
      })
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('persists JSON-mode clearing of all headers as explicit null merge-patch keys', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    useProviderMock.mockReturnValue({
      provider: {
        ...provider,
        settings: { extraHeaders: { 'X-Only': 'a' } }
      },
      updateProvider: updateProviderMock
    })

    render(<ProviderCustomHeaderDrawer providerId={provider.id} open onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'settings.provider.copilot.toggle_headers_editor_json' }))
    const textarea = screen.getByLabelText('settings.provider.copilot.custom_headers')
    await user.clear(textarea)
    await user.type(textarea, '{{}')
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(updateProviderMock).toHaveBeenCalledWith({
        endpointConfigs: provider.endpointConfigs,
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        providerSettings: { extraHeaders: { 'X-Only': null } }
      })
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
