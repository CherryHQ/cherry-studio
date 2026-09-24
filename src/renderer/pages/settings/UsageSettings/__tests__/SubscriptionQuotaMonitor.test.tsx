import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SubscriptionQuotaMonitor } from '../SubscriptionQuotaMonitor'

const mockProviders = vi.hoisted(() => ({
  list: [] as any[]
}))

const ipcApiRequestMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({
    providers: mockProviders.list
  })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: any[]) => ipcApiRequestMock(...args)
  }
}))

describe('SubscriptionQuotaMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviders.list = []
  })

  it('renders empty state when no providers have subscription enabled', () => {
    mockProviders.list = [
      {
        id: 'openai',
        name: 'OpenAI',
        settings: {
          subscription: {
            enabled: false
          }
        }
      }
    ]

    render(<SubscriptionQuotaMonitor />)

    expect(
      screen.getByText(/在“设置 - 模型提供商”中开启订阅制|settings\.usage\.quota\.empty_description/)
    ).toBeInTheDocument()
    const configBtn = screen.getByRole('button', { name: /配置提供商|settings\.usage\.quota\.configure_providers/i })
    expect(configBtn).toBeInTheDocument()
  })

  it('fetches and displays 5-hour quota, 7-day quota and resets for enabled provider', async () => {
    mockProviders.list = [
      {
        id: 'claude-code',
        name: 'Claude Code',
        settings: {
          subscription: {
            enabled: true,
            method: 'cli',
            cliCommand: 'claude /usage'
          }
        }
      }
    ]

    ipcApiRequestMock.mockResolvedValueOnce({
      providerId: 'claude-code',
      success: true,
      source: 'cli',
      fiveHour: {
        usedPercentage: 35,
        resetsInFormatted: '1h 45m'
      },
      sevenDay: {
        usedPercentage: 60,
        resetsInFormatted: '2026-09-30'
      },
      resets: {
        remainingCount: 5,
        totalCount: 10,
        resetInterval: '5h'
      },
      updatedAt: new Date().toISOString()
    })

    render(<SubscriptionQuotaMonitor />)

    await waitFor(() => {
      expect(ipcApiRequestMock).toHaveBeenCalledWith('provider.get_subscription_quota', {
        providerId: 'claude-code'
      })
    })

    expect(await screen.findByText('35%')).toBeInTheDocument()
    expect(await screen.findByText('60%')).toBeInTheDocument()
    expect(await screen.findByText('5')).toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
  })

  it('handles rejected quota request gracefully without infinite retry loop', async () => {
    mockProviders.list = [
      {
        id: 'failing-provider',
        name: 'Failing Provider',
        settings: {
          subscription: {
            enabled: true,
            method: 'auto'
          }
        }
      }
    ]

    ipcApiRequestMock.mockRejectedValue(new Error('Network connection timeout'))

    render(<SubscriptionQuotaMonitor />)

    await waitFor(() => {
      expect(ipcApiRequestMock).toHaveBeenCalledTimes(1)
    })

    expect(await screen.findByText(/Network connection timeout/)).toBeInTheDocument()
    expect(ipcApiRequestMock).toHaveBeenCalledTimes(1)
  })

  it('triggers refresh when refresh button is clicked', async () => {
    mockProviders.list = [
      {
        id: 'codex',
        name: 'OpenAI Codex',
        settings: {
          subscription: {
            enabled: true,
            method: 'auto'
          }
        }
      }
    ]

    ipcApiRequestMock.mockResolvedValue({
      providerId: 'codex',
      success: true,
      source: 'cli',
      fiveHour: { usedPercentage: 10 },
      sevenDay: { usedPercentage: 20 },
      resets: { resetInterval: 'weekly' },
      updatedAt: new Date().toISOString()
    })

    const user = userEvent.setup()
    render(<SubscriptionQuotaMonitor />)

    await waitFor(() => {
      expect(ipcApiRequestMock).toHaveBeenCalledWith('provider.get_subscription_quota', {
        providerId: 'codex'
      })
    })

    const refreshBtn = screen.getByRole('button', { name: /刷新|settings\.usage\.quota\.refresh/i })
    await user.click(refreshBtn)

    expect(ipcApiRequestMock).toHaveBeenCalledTimes(2)
  })
})
