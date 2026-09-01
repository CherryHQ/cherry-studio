import i18n from '@renderer/i18n/resolver'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderDeepLinkImport } from '../hooks/useProviderDeepLinkImport'
import ProviderSettingsPage from '../ProviderSettingsPage'

const navigateMock = vi.fn()
const useProvidersMock = vi.fn()
let searchMock: Record<string, string | undefined> = {}

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: (...args: unknown[]) => useProvidersMock(...args)
}))

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => searchMock,
  useNavigate: () => navigateMock
}))

vi.mock('../hooks/useProviderDeepLinkImport', () => ({
  useProviderDeepLinkImport: vi.fn()
}))

vi.mock('../ProviderList', () => ({
  ProviderList: ({ selectedProviderId, onSelectProvider, onCustomProviderCreated }: any) => (
    <div>
      <div data-testid="selected-provider-id">{selectedProviderId ?? ''}</div>
      <button type="button" onClick={() => onSelectProvider('openai')}>
        select-openai
      </button>
      <button type="button" onClick={() => onSelectProvider('anthropic')}>
        select-anthropic
      </button>
      <button type="button" onClick={() => onSelectProvider('custom-with-key')}>
        select-custom-with-key
      </button>
      <button
        type="button"
        onClick={() => {
          onSelectProvider('custom-with-key')
          onCustomProviderCreated('custom-with-key', true)
        }}>
        create-custom-with-key
      </button>
      <button
        type="button"
        onClick={() => {
          onSelectProvider('custom-without-key')
          onCustomProviderCreated('custom-without-key', false)
        }}>
        create-custom-without-key
      </button>
    </div>
  )
}))

vi.mock('../ProviderSetting', () => ({
  default: ({ providerId, initialApiSetupStep }: any) => (
    <div>
      <span>{`provider-setting-${providerId}`}</span>
      {initialApiSetupStep ? <span>{`api-setup-${initialApiSetupStep}`}</span> : null}
    </div>
  )
}))

describe('ProviderSettingsPage', () => {
  const providers = [
    { id: 'openai', name: 'OpenAI', isEnabled: true },
    { id: 'anthropic', name: 'Anthropic', isEnabled: true }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
    searchMock = {}
    useProvidersMock.mockReturnValue({
      providers,
      hasLoaded: true,
      isLoading: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined)
    })
  })

  it('shows loading state without mounting the provider list', () => {
    useProvidersMock.mockReturnValue({
      providers: [],
      hasLoaded: false,
      isLoading: true,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined)
    })

    render(<ProviderSettingsPage />)

    expect(screen.getByText(i18n.t('common.loading'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'select-openai' })).not.toBeInTheDocument()
  })

  it('shows a provider read failure and lets the user retry', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn().mockResolvedValue(undefined)
    useProvidersMock.mockReturnValue({
      providers: [],
      hasLoaded: false,
      isLoading: false,
      error: new Error('Provider registry unavailable'),
      refetch
    })

    render(<ProviderSettingsPage />)

    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('common.error'))
    expect(screen.getByRole('alert')).toHaveTextContent('Provider registry unavailable')
    expect(screen.queryByRole('button', { name: 'select-openai' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('keeps stale provider data visible when background revalidation fails', async () => {
    useProvidersMock.mockReturnValue({
      providers,
      hasLoaded: true,
      isLoading: false,
      error: new Error('Provider registry unavailable'),
      refetch: vi.fn().mockResolvedValue(undefined)
    })

    render(<ProviderSettingsPage />)

    expect(await screen.findByText('provider-setting-openai')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('preserves the remembered provider while an initial read fails', async () => {
    MockUseCacheUtils.setPersistCacheValue('settings.provider.last_selected_provider_id', 'anthropic')
    useProvidersMock.mockReturnValue({
      providers: [],
      hasLoaded: false,
      isLoading: false,
      error: new Error('Provider registry unavailable'),
      refetch: vi.fn().mockResolvedValue(undefined)
    })

    const { rerender } = render(<ProviderSettingsPage />)

    useProvidersMock.mockReturnValue({
      providers,
      hasLoaded: true,
      isLoading: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined)
    })
    rerender(<ProviderSettingsPage />)

    expect(await screen.findByText('provider-setting-anthropic')).toBeInTheDocument()
  })

  it('restores the last selected provider after leaving and returning to the page', async () => {
    const first = render(<ProviderSettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'select-anthropic' }))
    await screen.findByText('provider-setting-anthropic')

    first.unmount()
    render(<ProviderSettingsPage />)

    expect(screen.getByText('provider-setting-anthropic')).toBeInTheDocument()
    expect(screen.getByTestId('selected-provider-id')).toHaveTextContent('anthropic')
  })

  it('lets an explicit search id override the remembered provider', async () => {
    MockUseCacheUtils.setPersistCacheValue('settings.provider.last_selected_provider_id', 'openai')
    searchMock = { id: 'anthropic' }

    render(<ProviderSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('provider-setting-anthropic')).toBeInTheDocument()
    })
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/settings/provider',
      search: {},
      replace: true
    })
  })

  it('does not select CherryAI when it is remembered or requested by URL', async () => {
    MockUseCacheUtils.setPersistCacheValue('settings.provider.last_selected_provider_id', 'cherryai')
    searchMock = { id: 'cherryai' }
    useProvidersMock.mockReturnValue({
      providers: [{ id: 'cherryai', name: 'CherryAI', isEnabled: true }, ...providers]
    })

    render(<ProviderSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('provider-setting-openai')).toBeInTheDocument()
    })
    expect(screen.getByTestId('selected-provider-id')).toHaveTextContent('openai')
    expect(screen.queryByText('provider-setting-cherryai')).not.toBeInTheDocument()
  })

  it('passes a stable provider selector to deep-link import across rerenders', () => {
    const { rerender } = render(<ProviderSettingsPage />)
    const firstSelector = vi.mocked(useProviderDeepLinkImport).mock.calls.at(-1)?.[1]

    rerender(<ProviderSettingsPage />)

    expect(vi.mocked(useProviderDeepLinkImport).mock.calls.at(-1)?.[1]).toBe(firstSelector)
  })

  it.each([
    { button: 'create-custom-with-key', providerId: 'custom-with-key', expectedStep: 'models' },
    { button: 'create-custom-without-key', providerId: 'custom-without-key', expectedStep: 'api-key' }
  ])('opens $expectedStep setup after creating $providerId', async ({ button, providerId, expectedStep }) => {
    const user = userEvent.setup()
    useProvidersMock.mockReturnValue({
      providers: [...providers, { id: providerId, name: providerId, isEnabled: false }]
    })

    render(<ProviderSettingsPage />)
    await user.click(screen.getByRole('button', { name: button }))

    expect(await screen.findByText(`provider-setting-${providerId}`)).toBeInTheDocument()
    expect(screen.getByText(`api-setup-${expectedStep}`)).toBeInTheDocument()
  })

  it('does not reopen a stale setup request after selecting another provider', async () => {
    const user = userEvent.setup()
    useProvidersMock.mockReturnValue({
      providers: [...providers, { id: 'custom-with-key', name: 'Custom', isEnabled: false }]
    })

    render(<ProviderSettingsPage />)
    await user.click(screen.getByRole('button', { name: 'create-custom-with-key' }))
    expect(screen.getByText('api-setup-models')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'select-openai' }))
    await user.click(screen.getByRole('button', { name: 'select-custom-with-key' }))

    expect(screen.queryByText('api-setup-models')).not.toBeInTheDocument()
  })
})
