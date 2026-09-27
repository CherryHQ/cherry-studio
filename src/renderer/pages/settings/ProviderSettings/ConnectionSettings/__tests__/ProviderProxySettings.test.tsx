import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Provider } from '@shared/data/types/provider'

import ProviderProxySettings from '../ProviderProxySettings'

const updateProviderMock = vi.fn()
let mockProvider: Partial<Provider> | undefined

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) }
})

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({ provider: mockProvider }),
  useProviderMutations: () => ({ updateProvider: updateProviderMock })
}))

beforeEach(() => {
  vi.clearAllMocks()
  updateProviderMock.mockResolvedValue(undefined)
  mockProvider = { id: 'openai', settings: {} } as Partial<Provider>
})

describe('ProviderProxySettings', () => {
  it('lets the user type a multi-character URL without the field being disabled or reset mid-edit', () => {
    mockProvider = { id: 'openai', settings: { proxy: { mode: 'custom', url: '' } } } as Partial<Provider>
    render(<ProviderProxySettings providerId="openai" />)

    const input = screen.getByPlaceholderText('settings.provider.proxy_url_placeholder') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'h' } })
    fireEvent.change(input, { target: { value: 'ht' } })
    fireEvent.change(input, { target: { value: 'htt' } })
    fireEvent.change(input, { target: { value: 'http://proxy.example.com' } })

    // No network round-trip fired per keystroke — the field just held the draft.
    expect(updateProviderMock).not.toHaveBeenCalled()
    expect(input).not.toBeDisabled()
    expect(input.value).toBe('http://proxy.example.com')
  })

  it('commits the URL once, on blur', async () => {
    mockProvider = { id: 'openai', settings: { proxy: { mode: 'custom', url: '' } } } as Partial<Provider>
    render(<ProviderProxySettings providerId="openai" />)

    const input = screen.getByPlaceholderText('settings.provider.proxy_url_placeholder')
    fireEvent.change(input, { target: { value: 'http://proxy.example.com' } })
    fireEvent.blur(input)

    expect(updateProviderMock).toHaveBeenCalledTimes(1)
    expect(updateProviderMock).toHaveBeenCalledWith({
      providerSettings: { proxy: { mode: 'custom', url: 'http://proxy.example.com' } }
    })
  })

  it('does not commit on blur when the value is unchanged', () => {
    mockProvider = {
      id: 'openai',
      settings: { proxy: { mode: 'custom', url: 'http://existing.example.com' } }
    } as Partial<Provider>
    render(<ProviderProxySettings providerId="openai" />)

    const input = screen.getByPlaceholderText('settings.provider.proxy_url_placeholder')
    fireEvent.blur(input)

    expect(updateProviderMock).not.toHaveBeenCalled()
  })

  it('allows clearing the URL to empty', () => {
    mockProvider = {
      id: 'openai',
      settings: { proxy: { mode: 'custom', url: 'http://existing.example.com' } }
    } as Partial<Provider>
    render(<ProviderProxySettings providerId="openai" />)

    const input = screen.getByPlaceholderText('settings.provider.proxy_url_placeholder')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(updateProviderMock).toHaveBeenCalledWith({
      providerSettings: { proxy: { mode: 'custom', url: '' } }
    })
  })

  it('switching to custom mode shows the previously saved URL as the starting draft', () => {
    mockProvider = {
      id: 'openai',
      settings: { proxy: { mode: 'custom', url: 'http://existing.example.com' } }
    } as Partial<Provider>
    render(<ProviderProxySettings providerId="openai" />)

    expect(screen.getByPlaceholderText('settings.provider.proxy_url_placeholder')).toHaveValue(
      'http://existing.example.com'
    )
  })
})
