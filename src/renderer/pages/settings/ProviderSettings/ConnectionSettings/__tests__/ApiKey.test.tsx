import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiKey from '../ApiKey'

const useProviderMock = vi.fn()
const useProviderMetaMock = vi.fn()
const useAuthenticationApiKeyMock = vi.fn()
const keyListPropsSpy = vi.fn()

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
  default: (props: any) => {
    keyListPropsSpy(props)
    return props.open ? (
      <button type="button" onClick={() => props.onApiKeyChange?.('detect')}>
        emit-list-key-change
      </button>
    ) : null
  }
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
      serverApiKey: '',
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

  it('requests model detection after a changed primary API key is committed', async () => {
    const commitInputApiKeyNow = vi.fn().mockResolvedValue(undefined)
    const onConnectionModelDetection = vi.fn()
    useAuthenticationApiKeyMock.mockReturnValue({
      serverApiKey: '',
      inputApiKey: '',
      setInputApiKey: vi.fn(),
      hasPendingSync: true,
      commitInputApiKeyNow
    })
    const view = render(
      <ApiKey
        providerId="openai"
        apiKeyConnectivity={{ checking: false } as any}
        onOpenConnectionCheck={vi.fn()}
        onConnectionModelDetection={onConnectionModelDetection}
      />
    )

    const input = screen.getByPlaceholderText('settings.provider.api_key.placeholder')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'sk-new' } })
    expect(onConnectionModelDetection).toHaveBeenCalledWith({ intent: 'invalidate' })
    useAuthenticationApiKeyMock.mockReturnValue({
      serverApiKey: 'sk-new',
      inputApiKey: 'sk-new',
      setInputApiKey: vi.fn(),
      hasPendingSync: false,
      commitInputApiKeyNow
    })
    view.rerender(
      <ApiKey
        providerId="openai"
        apiKeyConnectivity={{ checking: false } as any}
        onOpenConnectionCheck={vi.fn()}
        onConnectionModelDetection={onConnectionModelDetection}
      />
    )
    fireEvent.blur(screen.getByPlaceholderText('settings.provider.api_key.placeholder'))

    await waitFor(() => {
      expect(onConnectionModelDetection).toHaveBeenCalledWith({
        intent: 'detect',
        shouldGuideExistingModels: true
      })
    })
  })

  it('invalidates a detected result when the primary API key is cleared', async () => {
    const commitInputApiKeyNow = vi.fn().mockResolvedValue(undefined)
    const onConnectionModelDetection = vi.fn()
    useAuthenticationApiKeyMock.mockReturnValue({
      serverApiKey: 'sk-old',
      inputApiKey: 'sk-old',
      setInputApiKey: vi.fn(),
      hasPendingSync: true,
      commitInputApiKeyNow
    })
    const view = render(
      <ApiKey
        providerId="openai"
        apiKeyConnectivity={{ checking: false } as any}
        onOpenConnectionCheck={vi.fn()}
        onConnectionModelDetection={onConnectionModelDetection}
      />
    )

    fireEvent.focus(screen.getByPlaceholderText('settings.provider.api_key.placeholder'))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api_key.placeholder'), { target: { value: '' } })
    useAuthenticationApiKeyMock.mockReturnValue({
      serverApiKey: '',
      inputApiKey: '',
      setInputApiKey: vi.fn(),
      hasPendingSync: false,
      commitInputApiKeyNow
    })
    view.rerender(
      <ApiKey
        providerId="openai"
        apiKeyConnectivity={{ checking: false } as any}
        onOpenConnectionCheck={vi.fn()}
        onConnectionModelDetection={onConnectionModelDetection}
      />
    )
    fireEvent.blur(screen.getByPlaceholderText('settings.provider.api_key.placeholder'))

    await waitFor(() => {
      expect(onConnectionModelDetection).toHaveBeenCalledWith({ intent: 'invalidate' })
    })
    expect(onConnectionModelDetection).toHaveBeenCalledTimes(1)
  })

  it('requests detection when an unchanged non-empty key loses focus', () => {
    const unchangedCommit = vi.fn().mockResolvedValue(undefined)
    const onConnectionModelDetection = vi.fn()
    useAuthenticationApiKeyMock.mockReturnValue({
      serverApiKey: 'sk-same',
      inputApiKey: 'sk-same',
      setInputApiKey: vi.fn(),
      hasPendingSync: false,
      commitInputApiKeyNow: unchangedCommit
    })
    render(
      <ApiKey
        providerId="openai"
        apiKeyConnectivity={{ checking: false } as any}
        onOpenConnectionCheck={vi.fn()}
        onConnectionModelDetection={onConnectionModelDetection}
      />
    )

    fireEvent.blur(screen.getByPlaceholderText('settings.provider.api_key.placeholder'))
    expect(unchangedCommit).not.toHaveBeenCalled()
    expect(onConnectionModelDetection).toHaveBeenCalledWith({ intent: 'detect' })
  })

  it('invalidates stale results but does not detect models when saving a changed key fails', async () => {
    const failedCommit = vi.fn().mockRejectedValue(new Error('save failed'))
    useAuthenticationApiKeyMock.mockReturnValue({
      serverApiKey: 'sk-same',
      inputApiKey: 'sk-same',
      setInputApiKey: vi.fn(),
      hasPendingSync: false,
      commitInputApiKeyNow: failedCommit
    })
    const onConnectionModelDetection = vi.fn()
    const view = render(
      <ApiKey
        providerId="openai"
        apiKeyConnectivity={{ checking: false } as any}
        onOpenConnectionCheck={vi.fn()}
        onConnectionModelDetection={onConnectionModelDetection}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api_key.placeholder'), {
      target: { value: 'sk-new' }
    })
    expect(onConnectionModelDetection).toHaveBeenCalledWith({ intent: 'invalidate' })

    useAuthenticationApiKeyMock.mockReturnValue({
      serverApiKey: 'sk-same',
      inputApiKey: 'sk-new',
      setInputApiKey: vi.fn(),
      hasPendingSync: true,
      commitInputApiKeyNow: failedCommit
    })
    view.rerender(
      <ApiKey
        providerId="openai"
        apiKeyConnectivity={{ checking: false } as any}
        onOpenConnectionCheck={vi.fn()}
        onConnectionModelDetection={onConnectionModelDetection}
      />
    )
    fireEvent.blur(screen.getByPlaceholderText('settings.provider.api_key.placeholder'))

    await waitFor(() => expect(failedCommit).toHaveBeenCalled())
    expect(onConnectionModelDetection).toHaveBeenCalledTimes(1)
    expect(onConnectionModelDetection).not.toHaveBeenCalledWith(expect.objectContaining({ intent: 'detect' }))
  })

  it('forwards API key list detection events', () => {
    const onConnectionModelDetection = vi.fn()
    render(
      <ApiKey
        providerId="openai"
        apiKeyConnectivity={{ checking: false } as any}
        onOpenConnectionCheck={vi.fn()}
        onConnectionModelDetection={onConnectionModelDetection}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api.key.list.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'emit-list-key-change' }))

    expect(onConnectionModelDetection).toHaveBeenCalledWith({ intent: 'detect' })
    expect(keyListPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ providerId: 'openai', open: true }))
  })
})
