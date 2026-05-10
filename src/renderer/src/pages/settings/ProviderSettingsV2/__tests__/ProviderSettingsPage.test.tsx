import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderDeepLinkImport } from '../coordination/useProviderDeepLinkImport'
import ProviderSettingsPage from '../ProviderSettingsPage'

const navigateMock = vi.fn()
const useProvidersMock = vi.fn()
let searchMock: Record<string, string | undefined> = {}

vi.mock('@renderer/hooks/useProviders', () => ({
  useProviders: (...args: unknown[]) => useProvidersMock(...args)
}))

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => searchMock,
  useNavigate: () => navigateMock
}))

vi.mock('../coordination/useProviderDeepLinkImport', () => ({
  useProviderDeepLinkImport: vi.fn()
}))

vi.mock('../ProviderList', () => ({
  default: ({ selectedProviderId, onSelectProvider }: any) => (
    <div>
      <div data-testid="selected-provider-id">{selectedProviderId ?? ''}</div>
      <button type="button" onClick={() => onSelectProvider('openai')}>
        select-openai
      </button>
      <button type="button" onClick={() => onSelectProvider('anthropic')}>
        select-anthropic
      </button>
    </div>
  )
}))

vi.mock('../ProviderSetting', () => ({
  default: ({ providerId }: any) => <div>{`provider-setting-${providerId}`}</div>
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
    useProvidersMock.mockReturnValue({ providers })
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
})
