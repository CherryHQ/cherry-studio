import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderSubscriptionSection } from '../SubscriptionSettings/ProviderSubscriptionSection'

const updateProviderMock = vi.fn()
const ipcApiRequestMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({
    provider: {
      id: 'claude-code',
      name: 'Claude Code',
      settings: {
        subscription: {
          enabled: true,
          method: 'cli',
          cliCommand: 'claude /usage'
        }
      }
    },
    updateProvider: updateProviderMock
  })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: any[]) => ipcApiRequestMock(...args)
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}))

describe('ProviderSubscriptionSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders subscription section with enabled switch and method options', () => {
    render(<ProviderSubscriptionSection providerId="claude-code" />)
    expect(screen.getByRole('switch')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeChecked()
    expect(screen.getByText(/订阅制|settings\.provider\.subscription\.title/)).toBeInTheDocument()
  })

  it('invokes test retrieval on button click and displays results', async () => {
    ipcApiRequestMock.mockResolvedValueOnce({
      providerId: 'claude-code',
      success: true,
      source: 'cli',
      fiveHour: { usedPercentage: 45, resetsInFormatted: '2h 15m' },
      sevenDay: { usedPercentage: 20, resetsInFormatted: 'Friday' },
      updatedAt: new Date().toISOString()
    })

    const user = userEvent.setup()
    render(<ProviderSubscriptionSection providerId="claude-code" />)

    const testBtn = screen.getByRole('button', { name: /测试获取|test_button/i })
    await user.click(testBtn)

    expect(ipcApiRequestMock).toHaveBeenCalledWith('provider.get_subscription_quota', {
      providerId: 'claude-code',
      method: 'cli',
      cliCommand: 'claude /usage',
      httpUrl: undefined
    })

    expect(await screen.findByText(/5h: 45%/)).toBeInTheDocument()
  })
})
