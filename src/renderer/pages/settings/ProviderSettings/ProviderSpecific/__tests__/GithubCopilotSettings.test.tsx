import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useProviderMock = vi.fn()
const updateProviderMock = vi.fn()
const deleteApiKeyMock = vi.fn()
const copilotLogoutMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../primitives/ProviderSettingsPrimitives', () => ({
  ProviderSettingsSubtitle: ({ children }: any) => <div>{children}</div>
}))

import GithubCopilotSettings from '../GithubCopilotSettings'

describe('GithubCopilotSettings', () => {
  const authedProvider = {
    id: 'copilot',
    apiKeys: [] as unknown[],
    settings: {
      isAuthed: true,
      oauthUsername: 'octocat',
      oauthAvatar: '',
      extraHeaders: { 'X-Copilot': '1' }
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    updateProviderMock.mockResolvedValue(undefined)
    deleteApiKeyMock.mockResolvedValue(undefined)
    copilotLogoutMock.mockResolvedValue(undefined)
    useProviderMock.mockReturnValue({
      provider: authedProvider,
      updateProvider: updateProviderMock,
      addApiKey: vi.fn(),
      deleteApiKey: deleteApiKeyMock
    })
    ;(window as any).api = { copilot: { logout: copilotLogoutMock } }
  })

  it('clears stored custom headers with a whole-key null merge patch on logout', async () => {
    const user = userEvent.setup()

    render(<GithubCopilotSettings providerId="copilot" />)

    await user.click(screen.getByRole('button', { name: 'settings.provider.copilot.logout' }))

    await waitFor(() => {
      expect(updateProviderMock).toHaveBeenCalledWith({
        providerSettings: {
          isAuthed: false,
          oauthUsername: '',
          oauthAvatar: '',
          extraHeaders: null
        }
      })
    })
    expect(copilotLogoutMock).toHaveBeenCalledTimes(1)
  })
})
