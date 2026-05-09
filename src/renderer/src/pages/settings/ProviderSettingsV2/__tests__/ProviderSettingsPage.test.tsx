import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    window.sessionStorage.clear()
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
    window.sessionStorage.setItem('provider-settings-v2:last-selected-provider-id', 'openai')
    searchMock = { id: 'anthropic' }

    render(<ProviderSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('provider-setting-anthropic')).toBeInTheDocument()
    })
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/settings/provider-v2',
      search: {},
      replace: true
    })
  })
})
