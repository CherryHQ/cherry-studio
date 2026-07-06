import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CherryInOauth from '../ProviderSpecific/CherryInOauth'

const useProviderMock = vi.fn()
const ipcApiRequestMock = vi.fn()

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

vi.mock('@cherrystudio/ui/icons', () => ({
  Cherryin: {
    Avatar: ({ size }: { size?: number }) => <div data-testid="cherryin-avatar">{size ?? 0}</div>
  }
}))

describe('CherryInOauth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).toast = {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn()
    }
    ;(window as any).modal = {
      confirm: vi.fn()
    }
    ipcApiRequestMock.mockImplementation((route: string) => {
      if (route === 'cherryin.get_balance') return Promise.resolve(DEFAULT_BALANCE)
      if (route === 'oauth.has_token') return Promise.resolve(true)
      return Promise.resolve(undefined)
    })
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
    expect(window.toast.error).not.toHaveBeenCalled()
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

    fireEvent.click(await screen.findByRole('button', { name: /退出登录|Logout/i }))

    const options = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    await act(async () => {
      await options.onOk()
    })

    expect(ipcApiRequestMock).toHaveBeenCalledWith('cherryin.logout', { apiHost: 'https://open.cherryin.ai' })
    expect(ipcApiRequestMock).toHaveBeenCalledWith('oauth.has_token', { providerId: 'cherryin' })
    expect(deleteApiKey).toHaveBeenCalledTimes(2)
    expect(deleteApiKey).toHaveBeenNthCalledWith(1, 'oauth-1')
    expect(deleteApiKey).toHaveBeenNthCalledWith(2, 'oauth-2')
    expect(window.toast.success).toHaveBeenCalled()
    expect(window.toast.warning).not.toHaveBeenCalled()
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

    fireEvent.click(await screen.findByRole('button', { name: /退出登录|Logout/i }))

    const options = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    await act(async () => {
      await options.onOk()
    })

    expect(deleteApiKey).toHaveBeenCalledTimes(2)
    expect(window.toast.warning).toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()
  })
})
