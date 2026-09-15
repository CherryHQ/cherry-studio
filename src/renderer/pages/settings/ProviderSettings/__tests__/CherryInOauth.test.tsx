import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { oauthWithCherryIn } from '@renderer/services/oauth'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'

import CherryInOauth from '../ProviderSpecific/CherryInOauth'

const useProviderMock = vi.fn()
const ipcApiRequestMock = vi.fn()
const oauthWithCherryInMock = vi.mocked(oauthWithCherryIn)

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: any[]) => ipcApiRequestMock(...args)
  }
}))

const DEFAULT_BALANCE = {
  balance: 128.5,
  profile: {
    displayName: 'Siin',
    username: 'siin',
    email: 'siin@gmail.com',
    group: 'Pro'
  }
}

const TOPPED_UP_BALANCE = { ...DEFAULT_BALANCE, balance: 256 }

vi.mock('@renderer/services/oauth', () => ({
  oauthWithCherryIn: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Skeleton: ({ className }: { className?: string }) => <div className={className} data-testid="skeleton" />
  }
})

vi.mock('@cherrystudio/ui/icons/providers', () => ({
  Cherryin: {
    Avatar: ({ size }: { size?: number }) => <div data-testid="cherryin-avatar">{size ?? 0}</div>
  }
}))

describe('CherryInOauth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    oauthWithCherryInMock.mockReset()
    ipcApiRequestMock.mockImplementation((route: string) => {
      if (route === 'cherryin.get_balance') return Promise.resolve(DEFAULT_BALANCE)
      if (route === 'oauth.has_token') return Promise.resolve(true)
      return Promise.resolve(undefined)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the logged-in card with balance and footer attribution', async () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'cherryin',
        name: 'CherryIN',
        apiKeys: [{ id: 'oauth-1', label: 'OAuth', isEnabled: true }],
        isEnabled: true
      },
      updateProvider: vi.fn(),
      addApiKey: vi.fn(),
      deleteApiKey: vi.fn()
    })

    render(<CherryInOauth providerId="cherryin" />)

    await waitFor(() => {
      expect(ipcApiRequestMock).toHaveBeenCalledWith('cherryin.get_balance', { apiHost: 'https://open.cherryin.ai' })
    })

    expect(screen.getByText('Siin')).toBeInTheDocument()
    expect(screen.getByText('siin@gmail.com')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('$128.50')).toBeInTheDocument()
    expect(screen.getByText(/open\.cherryin\.ai/)).toBeInTheDocument()
  })

  it('keeps balance fetch failures quiet and shows the empty balance state', async () => {
    ipcApiRequestMock.mockImplementation((route: string) => {
      if (route === 'cherryin.get_balance') {
        return Promise.reject(new Error('Failed to get balance: HTTP 401 Unauthorized'))
      }
      if (route === 'oauth.has_token') return Promise.resolve(true)
      return Promise.resolve(undefined)
    })
    useProviderMock.mockReturnValue({
      provider: {
        id: 'cherryin',
        name: 'CherryIN',
        apiKeys: [{ id: 'oauth-1', label: 'OAuth', isEnabled: true }],
        isEnabled: true
      },
      updateProvider: vi.fn(),
      addApiKey: vi.fn(),
      deleteApiKey: vi.fn()
    })

    render(<CherryInOauth providerId="cherryin" />)

    await waitFor(() => {
      expect(ipcApiRequestMock).toHaveBeenCalledWith('cherryin.get_balance', { apiHost: 'https://open.cherryin.ai' })
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('renders the logged-out card when there is no OAuth token', () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'cherryin',
        name: 'CherryIN',
        apiKeys: [],
        isEnabled: true
      },
      updateProvider: vi.fn(),
      addApiKey: vi.fn(),
      deleteApiKey: vi.fn()
    })
    ipcApiRequestMock.mockImplementation((route: string) =>
      route === 'oauth.has_token' ? Promise.resolve(false) : Promise.resolve(undefined)
    )

    render(<CherryInOauth providerId="cherryin" />)

    const loginButton = screen.getByRole('button', { name: /CherryIN|授权/i })
    const tagline = screen.getByText(/登录后即可使用所有模型服务|all model services/i)

    expect(loginButton).toBeInTheDocument()
    expect(screen.getByTestId('cherryin-avatar')).toBeInTheDocument()
    expect(tagline.compareDocumentPosition(loginButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('cancels a preset-derived CherryIN login through its registered OAuth provider', async () => {
    let rejectSignIn: (error: unknown) => void = () => {}
    oauthWithCherryInMock.mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectSignIn = reject
        })
    )
    useProviderMock.mockReturnValue({
      provider: { id: 'custom-cherryin', presetProviderId: 'cherryin', name: 'CherryIN', apiKeys: [], isEnabled: true },
      updateProvider: vi.fn(),
      addApiKey: vi.fn(),
      deleteApiKey: vi.fn()
    })
    ipcApiRequestMock.mockImplementation((route: string, input?: { providerId?: string }) => {
      if (route === 'oauth.has_token') return Promise.resolve(false)
      if (route === 'oauth.cancel_sign_in' && input?.providerId === 'cherryin') {
        rejectSignIn(new IpcError(oauthErrorCodes.SIGN_IN_CANCELLED))
        return Promise.resolve(undefined)
      }
      return Promise.resolve(undefined)
    })
    const user = userEvent.setup()

    render(<CherryInOauth providerId="custom-cherryin" />)

    const loginButton = screen.getByRole('button', { name: /CherryIN|授权/i })
    await user.click(loginButton)

    expect(loginButton).toBeDisabled()
    expect(loginButton.querySelector('.animate-spin')).toBeInTheDocument()
    const cancelButton = screen.getByRole('button', { name: /取消|Cancel/i })
    expect(cancelButton).toBeEnabled()
    expect(oauthWithCherryInMock).toHaveBeenCalledWith(expect.any(Function), {
      oauthServer: 'https://open.cherryin.ai',
      requestId: expect.any(String)
    })

    const requestId = oauthWithCherryInMock.mock.calls[0][1].requestId
    await user.click(cancelButton)

    await waitFor(() => expect(loginButton).toBeEnabled())
    expect(ipcApiRequestMock).toHaveBeenCalledWith('oauth.has_token', { providerId: 'cherryin' })
    expect(ipcApiRequestMock).toHaveBeenCalledWith('oauth.cancel_sign_in', {
      providerId: 'cherryin',
      requestId
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('restores the login action and reports an OAuth failure', async () => {
    oauthWithCherryInMock.mockRejectedValueOnce(new Error('login failed'))
    useProviderMock.mockReturnValue({
      provider: { id: 'cherryin', name: 'CherryIN', apiKeys: [], isEnabled: true },
      updateProvider: vi.fn(),
      addApiKey: vi.fn(),
      deleteApiKey: vi.fn()
    })
    ipcApiRequestMock.mockImplementation((route: string) =>
      route === 'oauth.has_token' ? Promise.resolve(false) : Promise.resolve(undefined)
    )
    const user = userEvent.setup()

    render(<CherryInOauth providerId="cherryin" />)

    const loginButton = screen.getByRole('button', { name: /CherryIN|授权/i })
    await user.click(loginButton)

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(loginButton).toBeEnabled()
    expect(screen.queryByRole('button', { name: /取消|Cancel/i })).not.toBeInTheDocument()
  })

  it('logs out and removes every OAuth-labelled key after confirmation', async () => {
    const deleteApiKey = vi.fn().mockResolvedValue(undefined)

    useProviderMock.mockReturnValue({
      provider: {
        id: 'cherryin',
        name: 'CherryIN',
        apiKeys: [
          { id: 'oauth-1', label: 'OAuth', isEnabled: true },
          { id: 'oauth-2', label: 'OAuth', isEnabled: true },
          { id: 'manual-1', label: 'Manual', isEnabled: true }
        ],
        isEnabled: true
      },
      updateProvider: vi.fn(),
      addApiKey: vi.fn(),
      deleteApiKey
    })

    render(<CherryInOauth providerId="cherryin" />)

    const logoutButton = await screen.findByRole('button', { name: /退出登录|Logout/i })
    // The global popup.confirm mock auto-invokes onOk (the "confirmed" path) and resolves true.
    await act(async () => {
      fireEvent.click(logoutButton)
    })

    expect(popup.confirm).toHaveBeenCalled()
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled()
    })

    expect(ipcApiRequestMock).toHaveBeenCalledWith('cherryin.logout', { apiHost: 'https://open.cherryin.ai' })
    expect(ipcApiRequestMock).toHaveBeenCalledWith('oauth.has_token', { providerId: 'cherryin' })
    expect(deleteApiKey).toHaveBeenCalledTimes(2)
    expect(deleteApiKey).toHaveBeenNthCalledWith(1, 'oauth-1')
    expect(deleteApiKey).toHaveBeenNthCalledWith(2, 'oauth-2')
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('shows a warning instead of success when OAuth key cleanup partially fails', async () => {
    const deleteApiKey = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('delete failed'))

    useProviderMock.mockReturnValue({
      provider: {
        id: 'cherryin',
        name: 'CherryIN',
        apiKeys: [
          { id: 'oauth-1', label: 'OAuth', isEnabled: true },
          { id: 'oauth-2', label: 'OAuth', isEnabled: true }
        ],
        isEnabled: true
      },
      updateProvider: vi.fn(),
      addApiKey: vi.fn(),
      deleteApiKey
    })

    render(<CherryInOauth providerId="cherryin" />)

    const logoutButton = await screen.findByRole('button', { name: /退出登录|Logout/i })
    // The global popup.confirm mock auto-invokes onOk (the "confirmed" path) and resolves true.
    await act(async () => {
      fireEvent.click(logoutButton)
    })

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalled()
    })
    expect(deleteApiKey).toHaveBeenCalledTimes(2)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('refreshes the balance once after returning from top-up', async () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'cherryin',
        name: 'CherryIN',
        apiKeys: [{ id: 'oauth-1', label: 'OAuth', isEnabled: true }],
        isEnabled: true
      },
      updateProvider: vi.fn(),
      addApiKey: vi.fn(),
      deleteApiKey: vi.fn()
    })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(<CherryInOauth providerId="cherryin" />)
    await screen.findByText('$128.50')

    ipcApiRequestMock.mockClear()
    ipcApiRequestMock.mockImplementation((route: string) => {
      if (route === 'cherryin.get_balance') return Promise.resolve(TOPPED_UP_BALANCE)
      if (route === 'oauth.has_token') return Promise.resolve(true)
      return Promise.resolve(undefined)
    })

    fireEvent.focus(window)
    expect(ipcApiRequestMock).not.toHaveBeenCalled()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /充值|Top Up/i }))
    expect(openSpy).toHaveBeenCalledWith('https://open.cherryin.ai/console/topup', '_blank')

    fireEvent.focus(window)
    await screen.findByText('$256.00')
    expect(ipcApiRequestMock).toHaveBeenCalledTimes(1)
    expect(ipcApiRequestMock).toHaveBeenCalledWith('cherryin.get_balance', {
      apiHost: 'https://open.cherryin.ai'
    })

    ipcApiRequestMock.mockClear()
    fireEvent.focus(window)
    expect(ipcApiRequestMock).not.toHaveBeenCalled()
  })
})
