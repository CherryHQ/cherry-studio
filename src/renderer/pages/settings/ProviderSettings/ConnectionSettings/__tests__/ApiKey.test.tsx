import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiKey from '../ApiKey'

const useProviderMock = vi.fn()
const useProviderMetaMock = vi.fn()
const useAuthenticationApiKeyMock = vi.fn()

vi.mock('@cherrystudio/ui', () => ({
  InputGroup: ({ children }: any) => <div>{children}</div>,
  InputGroupAddon: ({ children }: any) => <span>{children}</span>,
  InputGroupInput: (props: any) => <input {...props} />,
  Tooltip: ({ children }: any) => <>{children}</>
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../../hooks/providerSetting/useProviderMeta', () => ({
  useProviderMeta: (...args: any[]) => useProviderMetaMock(...args)
}))

vi.mock('../../hooks/providerSetting/useAuthenticationApiKey', () => ({
  useAuthenticationApiKey: (...args: any[]) => useAuthenticationApiKeyMock(...args)
}))

vi.mock('../ProviderApiKeyListDrawer', () => ({
  default: () => null
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
      provider: { id: 'openai', name: 'OpenAI' }
    })
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

  it('disables the check button for normal providers without an API key', () => {
    render(
      <ApiKey providerId="openai" apiKeyConnectivity={{ checking: false } as any} onOpenConnectionCheck={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'settings.provider.check' })).toBeDisabled()
  })

  it('allows the check button for no-key providers without an API key', () => {
    const onOpenConnectionCheck = vi.fn()
    useProviderMock.mockReturnValue({
      provider: { id: 'ollama', name: 'Ollama' }
    })

    render(
      <ApiKey
        providerId="ollama"
        apiKeyConnectivity={{ checking: false } as any}
        onOpenConnectionCheck={onOpenConnectionCheck}
        requiresApiKey={false}
      />
    )

    const checkButton = screen.getByRole('button', { name: 'settings.provider.check' })
    expect(checkButton).not.toBeDisabled()

    fireEvent.click(checkButton)
    expect(onOpenConnectionCheck).toHaveBeenCalledTimes(1)
  })
})
