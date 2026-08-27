import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiKey from '../ApiKey'

const useProviderMock = vi.fn()
const useProviderApiKeysMock = vi.fn()
const useProviderMetaMock = vi.fn()
const useAuthenticationApiKeyMock = vi.fn()

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
      provider: { id: 'openai', name: 'OpenAI', authOptional: false }
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

  it('opens key management from the masked saved-key area without a separate management button', async () => {
    const user = userEvent.setup()
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'key-1', key: '123456789012345678901234', isEnabled: true }] }
    })

    render(<ApiKey providerId="openai" />)

    const maskedKey = screen.getByText('1234****1234')
    expect(maskedKey).toBeInTheDocument()
    expect(screen.queryByText('123456789012345678901234')).not.toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    const keyListButtons = screen.getAllByRole('button', { name: 'settings.provider.api.key.list.title' })
    const keyAreaButton = maskedKey.closest('button')
    const modelCheckButton = screen.getByRole('button', { name: 'settings.models.check.button_caption' })

    expect(keyAreaButton).toBe(keyListButtons[0])
    expect(keyListButtons).toHaveLength(1)
    expect(buttons.indexOf(keyAreaButton!)).toBeLessThan(buttons.indexOf(modelCheckButton))

    await user.click(maskedKey)

    expect(screen.getByRole('dialog', { name: 'settings.provider.api.key.list.title' })).toBeInTheDocument()
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
