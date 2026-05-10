import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CherryINOAuth from '../ProviderSpecific/CherryINOAuth'

const useProviderMock = vi.fn()
const useProviderAuthConfigMock = vi.fn()

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderAuthConfig: (...args: any[]) => useProviderAuthConfigMock(...args)
}))

vi.mock('@renderer/utils/oauth', () => ({
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

describe('CherryINOAuth', () => {
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
    ;(window as any).api = {
      getAppInfo: vi.fn().mockResolvedValue({}),
      cherryin: {
        getBalance: vi.fn().mockResolvedValue({
          balance: 128.5,
          profile: {
            displayName: 'Siin',
            username: 'siin',
            email: 'siin@gmail.com',
            group: 'Pro'
          },
          monthlyUsageTokens: null,
          monthlySpend: 6.82
        }),
        logout: vi.fn().mockResolvedValue(undefined)
      }
    }
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
    useProviderAuthConfigMock.mockReturnValue({
      data: {
        type: 'oauth',
        clientId: 'client-id',
        accessToken: 'oauth-access',
        refreshToken: 'oauth-refresh'
      },
      isLoading: false,
      refetch: vi.fn()
    })

    render(<CherryINOAuth providerId="cherryin" />)

    await waitFor(() => {
      expect(window.api.cherryin.getBalance).toHaveBeenCalledWith('https://open.cherryin.ai')
    })

    expect(screen.getByText('Siin')).toBeInTheDocument()
    expect(screen.getByText('siin@gmail.com')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('$128.50')).toBeInTheDocument()
    expect(screen.getByText(/open\.cherryin\.ai/)).toBeInTheDocument()
  })

  it('keeps balance fetch failures quiet and shows the empty balance state', async () => {
    window.api.cherryin.getBalance = vi
      .fn()
      .mockRejectedValue(new Error('Failed to get balance: HTTP 401 Unauthorized'))
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
    useProviderAuthConfigMock.mockReturnValue({
      data: {
        type: 'oauth',
        clientId: 'client-id',
        accessToken: 'oauth-access',
        refreshToken: 'oauth-refresh'
      },
      isLoading: false,
      refetch: vi.fn()
    })

    render(<CherryINOAuth providerId="cherryin" />)

    await waitFor(() => {
      expect(window.api.cherryin.getBalance).toHaveBeenCalledWith('https://open.cherryin.ai')
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
    useProviderAuthConfigMock.mockReturnValue({
      data: null,
      isLoading: false,
      refetch: vi.fn()
    })

    render(<CherryINOAuth providerId="cherryin" />)

    expect(screen.getByRole('button', { name: /OAuth/i })).toBeInTheDocument()
    expect(screen.getByTestId('cherryin-avatar')).toBeInTheDocument()
  })

  it('logs out and removes every OAuth-labelled key after confirmation', async () => {
    const deleteApiKey = vi.fn().mockResolvedValue(undefined)
    const refetchAuthConfig = vi.fn().mockResolvedValue(undefined)

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
    useProviderAuthConfigMock.mockReturnValue({
      data: {
        type: 'oauth',
        clientId: 'client-id',
        accessToken: 'oauth-access',
        refreshToken: 'oauth-refresh'
      },
      isLoading: false,
      refetch: refetchAuthConfig
    })

    render(<CherryINOAuth providerId="cherryin" />)

    fireEvent.click(screen.getByRole('button', { name: /退出登录|Logout/i }))

    const options = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    await act(async () => {
      await options.onOk()
    })

    expect(window.api.cherryin.logout).toHaveBeenCalledWith('https://open.cherryin.ai')
    expect(refetchAuthConfig).toHaveBeenCalled()
    expect(deleteApiKey).toHaveBeenCalledTimes(2)
    expect(deleteApiKey).toHaveBeenNthCalledWith(1, 'oauth-1')
    expect(deleteApiKey).toHaveBeenNthCalledWith(2, 'oauth-2')
  })
})
