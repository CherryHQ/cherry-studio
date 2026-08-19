import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CherryInOauth from '../CherryInOauth'

const { requestMock, tMock, useProviderMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  tMock: (key: string) => key,
  useProviderMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => requestMock(...args) }
}))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: unknown[]) => useProviderMock(...args)
}))
vi.mock('@renderer/services/oauth', () => ({
  oauthWithCherryIn: vi.fn()
}))
vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Skeleton: ({ className }: { className?: string }) => <div className={className} data-testid="skeleton" />
}))
vi.mock('@cherrystudio/ui/icons/providers', () => ({
  Cherryin: { Avatar: () => <div data-testid="cherryin-avatar" /> }
}))

const LOGGED_IN_PROVIDER = {
  id: 'cherryin',
  name: 'CherryIN',
  apiKeys: [{ id: 'key-1', label: 'OAuth', isEnabled: true }]
}

const ZERO_BALANCE = { balance: 0, profile: null }
const TOPPED_UP_BALANCE = { balance: 12.5, profile: null }

beforeEach(() => {
  vi.clearAllMocks()
  MockUseDataApiUtils.resetMocks()
  useProviderMock.mockReturnValue({
    provider: LOGGED_IN_PROVIDER,
    updateProvider: vi.fn().mockResolvedValue(undefined),
    addApiKey: vi.fn().mockResolvedValue(undefined),
    deleteApiKey: vi.fn().mockResolvedValue(undefined)
  })
})

async function renderLoggedIn(): Promise<void> {
  requestMock.mockImplementation((channel: string) => {
    if (channel === 'oauth.has_token') return Promise.resolve(true)
    if (channel === 'cherryin.get_balance') return Promise.resolve(ZERO_BALANCE)
    throw new Error(`unexpected channel: ${channel}`)
  })
  render(<CherryInOauth providerId="cherryin" />)
  await screen.findByText('settings.provider.oauth.topup')
}

describe('CherryInOauth', () => {
  it('re-fetches the balance when the window regains focus after a top-up', async () => {
    await renderLoggedIn()
    expect(requestMock).toHaveBeenCalledWith('cherryin.get_balance', expect.anything())
    await screen.findByText('$0.00')

    // The recharge happens on the CherryIN console in the system browser; the
    // renderer learns the new balance only when it asks again.
    let callCount = 0
    requestMock.mockImplementation((channel: string) => {
      if (channel === 'oauth.has_token') return Promise.resolve(true)
      if (channel === 'cherryin.get_balance') {
        callCount += 1
        return Promise.resolve(TOPPED_UP_BALANCE)
      }
      throw new Error(`unexpected channel: ${channel}`)
    })

    const user = userEvent.setup()
    await user.click(screen.getByText('settings.provider.oauth.topup'))
    fireEvent.focus(window)

    await waitFor(() => expect(callCount).toBe(1))
    await screen.findByText('$12.50')
  })

  it('does not re-fetch the balance on focus when no top-up was initiated', async () => {
    await renderLoggedIn()

    requestMock.mockClear()
    requestMock.mockImplementation((channel: string) => {
      if (channel === 'cherryin.get_balance') return Promise.resolve(TOPPED_UP_BALANCE)
      if (channel === 'oauth.has_token') return Promise.resolve(true)
      throw new Error(`unexpected channel: ${channel}`)
    })

    fireEvent.focus(window)

    // Give any stray listener a chance to fire before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requestMock).not.toHaveBeenCalledWith('cherryin.get_balance', expect.anything())
  })
})
