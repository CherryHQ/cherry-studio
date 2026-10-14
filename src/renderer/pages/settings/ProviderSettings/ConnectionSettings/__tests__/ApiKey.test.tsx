import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiKey from '../ApiKey'

const useProviderMock = vi.fn()
const useProviderApiKeysMock = vi.fn()
const useProviderMetaMock = vi.fn()
const useAuthenticationApiKeyMock = vi.fn()
const deleteApiKeyMock = vi.fn()
const copyApiKeyToClipboardMock = vi.fn()

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, type = 'button', ...props }: any) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
  InputGroup: ({ children }: any) => <div>{children}</div>,
  InputGroupAddon: ({ children }: any) => <span>{children}</span>,
  InputGroupInput: (props: any) => <input {...props} />,
  Tooltip: ({ children }: any) => <>{children}</>
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args)
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn() }
}))

vi.mock('../copyApiKeyToClipboard', () => ({
  copyApiKeyToClipboard: (...args: any[]) => copyApiKeyToClipboardMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderMeta', () => ({
  useProviderMeta: (...args: any[]) => useProviderMetaMock(...args)
}))

vi.mock('../../hooks/providerSetting/useAuthenticationApiKey', () => ({
  useAuthenticationApiKey: (...args: any[]) => useAuthenticationApiKeyMock(...args)
}))

vi.mock('../ProviderApiKeyListDrawer', () => ({
  default: ({ open }: any) => (open ? <div role="dialog" aria-label="settings.provider.api.key.list.title" /> : null)
}))

vi.mock('../../ModelList', () => ({
  ProviderModelCheck: () => <button type="button" aria-label="settings.models.check.button_caption" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('ApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI', authOptional: false },
      deleteApiKey: deleteApiKeyMock,
      isDeletingApiKey: false
    })
    useProviderApiKeysMock.mockReturnValue({ data: { keys: [] } })
    useProviderMetaMock.mockReturnValue({
      isApiKeyFieldVisible: true,
      apiKeyWebsite: undefined,
      isDmxapi: false
    })
    useAuthenticationApiKeyMock.mockReturnValue({
      inputApiKey: '',
      setInputApiKey: vi.fn(),
      hasPendingSync: false,
      commitInputApiKeyNow: vi.fn()
    })
  })

  it('shows setup and key-management actions when a required key is missing', async () => {
    const user = userEvent.setup()
    const onOpenApiSetup = vi.fn()

    render(<ApiKey providerId="openai" onOpenApiSetup={onOpenApiSetup} />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.add_key' }))
    expect(onOpenApiSetup).toHaveBeenCalledTimes(1)

    const keyManagementButton = screen.getByRole('button', { name: 'settings.provider.api.key.list.title' })
    expect(keyManagementButton).toHaveAttribute('aria-haspopup', 'dialog')
    expect(keyManagementButton).toHaveAttribute('aria-expanded', 'false')
    await user.click(keyManagementButton)

    expect(keyManagementButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'settings.provider.api.key.list.title' })).toBeInTheDocument()
  })

  it('keeps a separate key-management action beside the masked saved-key area', async () => {
    const user = userEvent.setup()
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'key-1', key: '123456789012345678901234', isEnabled: true }] }
    })

    render(<ApiKey providerId="openai" />)

    const maskedKey = screen.getByText('12****1234')
    expect(maskedKey).toBeInTheDocument()
    expect(screen.queryByText('123456789012345678901234')).not.toBeInTheDocument()
    const keyListButtons = screen.getAllByRole('button', { name: 'settings.provider.api.key.list.title' })
    const keyAreaButton = maskedKey.closest('button')
    const keyManagementButton = keyListButtons[1]

    expect(keyAreaButton).toBe(keyListButtons[0])
    expect(keyListButtons).toHaveLength(2)
    expect(keyManagementButton).toHaveAttribute('aria-haspopup', 'dialog')
    expect(keyManagementButton).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByRole('button', { name: 'settings.provider.api_key.show_key' }))
    expect(screen.getByText('123456789012345678901234')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'settings.provider.api.key.list.title' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.provider.api_key.hide_key' }))
    expect(screen.getByText('12****1234')).toBeInTheDocument()

    await user.click(keyManagementButton)

    expect(keyManagementButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'settings.provider.api.key.list.title' })).toBeInTheDocument()
  })

  it('offers copy, edit, and delete actions for the displayed key', async () => {
    const user = userEvent.setup()
    const onOpenApiSetup = vi.fn()
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'key-1', key: 'sk-visible-action', isEnabled: true }] }
    })

    render(<ApiKey providerId="openai" onOpenApiSetup={onOpenApiSetup} />)

    await user.click(screen.getByRole('button', { name: 'settings.provider.api_key.copy' }))
    expect(copyApiKeyToClipboardMock).toHaveBeenCalledWith('sk-visible-action', expect.any(Function))

    await user.click(screen.getByRole('button', { name: 'common.edit' }))
    expect(onOpenApiSetup).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'settings.provider.api.key.list.title' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.delete' }))
    expect(deleteApiKeyMock).toHaveBeenCalledWith('key-1')
  })

  it('hides the summary delete action when multiple keys exist', () => {
    useProviderApiKeysMock.mockReturnValue({
      data: {
        keys: [
          { id: 'key-1', key: 'sk-primary', isEnabled: true },
          { id: 'key-2', key: 'sk-backup', isEnabled: true }
        ]
      }
    })

    render(<ApiKey providerId="openai" />)

    expect(screen.queryByRole('button', { name: 'common.delete' })).not.toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('never exposes a short saved key that the shared formatter cannot partially mask', () => {
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'key-1', key: 'short', isEnabled: true }] }
    })

    render(<ApiKey providerId="openai" />)

    expect(screen.getByText('••••••••')).toBeInTheDocument()
    expect(screen.queryByText('short')).not.toBeInTheDocument()
  })

  it('keeps the existing inline key field for providers with optional authentication', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'ollama', name: 'Ollama', authOptional: true }
    })

    render(<ApiKey providerId="ollama" />)

    expect(screen.getByPlaceholderText('settings.provider.api_key.placeholder')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.provider.api_setup.add_key' })).not.toBeInTheDocument()
  })
})
