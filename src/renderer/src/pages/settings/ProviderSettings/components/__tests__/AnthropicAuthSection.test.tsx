import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AnthropicAuthSection from '../../ConnectionSettings/AnthropicAuthSection'

const useProviderMock = vi.fn()
const useProviderMutationsMock = vi.fn()
const updateAuthConfigMock = vi.fn()
const { loggerErrorMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderMutations: (...args: any[]) => useProviderMutationsMock(...args)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock
    })
  }
}))

vi.mock('../../ProviderSpecific/AnthropicSettings', () => ({
  default: () => <div>anthropic-settings</div>
}))

vi.mock('../../primitives/InlineSelector', () => ({
  default: ({ value, onChange, options }: any) => (
    <div>
      <div>{`selected:${value}`}</div>
      {options.map((option: any) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}>
          {option.value}
        </button>
      ))}
    </div>
  )
}))

vi.mock('../../primitives/ProviderField', () => ({
  default: ({ children }: any) => <div>{children}</div>
}))

vi.mock('../../primitives/ProviderSection', () => ({
  default: ({ children }: any) => <div>{children}</div>
}))

describe('AnthropicAuthSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).toast = {
      error: vi.fn()
    }
    useProviderMutationsMock.mockReturnValue({
      updateAuthConfig: updateAuthConfigMock
    })
  })

  it('submits a valid oauth authConfig when switching auth method', () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'anthropic',
        authType: 'api-key'
      }
    })

    render(<AnthropicAuthSection providerId="anthropic" />)

    fireEvent.click(screen.getByRole('button', { name: 'oauth' }))

    expect(updateAuthConfigMock).toHaveBeenCalledWith({
      type: 'oauth',
      clientId: ''
    })
  })

  it('submits api-key authConfig when switching back to api-key', () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'anthropic',
        authType: 'oauth'
      }
    })

    render(<AnthropicAuthSection providerId="anthropic" />)

    fireEvent.click(screen.getByRole('button', { name: 'api-key' }))

    expect(updateAuthConfigMock).toHaveBeenCalledWith({
      type: 'api-key'
    })
  })

  it('renders oauth settings when provider is already in oauth mode', () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'anthropic',
        authType: 'oauth',
        authConfig: {
          type: 'oauth'
        }
      }
    })

    render(<AnthropicAuthSection providerId="anthropic" />)

    expect(screen.getByText('anthropic-settings')).toBeInTheDocument()
  })

  it('returns nothing when provider is missing', () => {
    useProviderMock.mockReturnValue({
      provider: undefined
    })

    const { container } = render(<AnthropicAuthSection providerId="anthropic" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('logs and toasts when auth config update fails', async () => {
    updateAuthConfigMock.mockRejectedValueOnce(new Error('network failed'))
    useProviderMock.mockReturnValue({
      provider: {
        id: 'anthropic',
        authType: 'api-key'
      }
    })

    render(<AnthropicAuthSection providerId="anthropic" />)

    fireEvent.click(screen.getByRole('button', { name: 'oauth' }))

    await Promise.resolve()

    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to update Anthropic auth config', {
      providerId: 'anthropic',
      error: expect.any(Error)
    })
    expect(window.toast.error).toHaveBeenCalledWith('settings.provider.save_failed')
  })
})
