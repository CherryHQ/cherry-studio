import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FC } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { oauthErrorCodes } from '@shared/ipc/errors/oauth'

const { requestMock, providerState } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  providerState: { signedIn: true }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: () => null
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => requestMock(...args) }
}))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({
    provider: {
      id: 'cherryin',
      name: 'CherryIN',
      apiKeys: providerState.signedIn ? [{ id: 'k1', key: 'sk-test', label: 'OAuth', isEnabled: true }] : []
    },
    updateProvider: vi.fn().mockResolvedValue(undefined),
    addApiKey: vi.fn().mockResolvedValue(undefined),
    deleteApiKey: vi.fn().mockResolvedValue(undefined)
  })
}))

let CherryInOauth: FC<{ providerId: string }>

function analyticsEvents(event: string) {
  return requestMock.mock.calls
    .filter(([route, payload]) => route === 'analytics.track' && payload.event === event)
    .map(([, payload]) => payload)
}

function mockBalances(...balances: number[]) {
  const queue = [...balances]
  requestMock.mockImplementation(async (route: string) => {
    if (route === 'oauth.has_token') return providerState.signedIn
    if (route === 'cherryin.get_balance') return { balance: queue.length > 1 ? queue.shift() : queue[0], profile: null }
    return undefined
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  providerState.signedIn = true
  mockBalances(1)
  CherryInOauth = (await import('../CherryInOauth')).default
})

describe('CherryInOauth analytics', () => {
  it('reports the card once per window, only after its sign-in state is known', async () => {
    let resolveToken: (value: boolean) => void = () => {}
    requestMock.mockImplementation((route: string) => {
      if (route === 'oauth.has_token') return new Promise((resolve) => (resolveToken = resolve))
      if (route === 'cherryin.get_balance') return Promise.resolve({ balance: 1, profile: null })
      return Promise.resolve(undefined)
    })
    const { unmount } = render(<CherryInOauth providerId="cherryin" />)
    expect(analyticsEvents('cherryin_entry_view')).toEqual([])

    await act(async () => resolveToken(true))
    await waitFor(() =>
      expect(analyticsEvents('cherryin_entry_view')).toEqual([{ event: 'cherryin_entry_view', signedIn: true }])
    )

    unmount()
    mockBalances(1)
    render(<CherryInOauth providerId="cherryin" />)
    await screen.findByText('settings.provider.oauth.topup')
    expect(analyticsEvents('cherryin_entry_view')).toHaveLength(1)
  })

  it('opens the top-up page with the click attribution and reports a balance increase under it', async () => {
    mockBalances(1, 5)
    const user = userEvent.setup()
    render(<CherryInOauth providerId="cherryin" />)

    await user.click(await screen.findByText('settings.provider.oauth.topup'))
    const [clicked] = analyticsEvents('cherryin_topup_clicked')
    expect(clicked).toEqual({
      event: 'cherryin_topup_clicked',
      source: 'provider_settings',
      flowId: expect.any(String)
    })
    const opened = requestMock.mock.calls.find(([route]) => route === 'system.shell.open_external_website')?.[1]
    const url = new URL(opened)
    expect(url.origin + url.pathname).toBe('https://open.cherryin.ai/console/topup')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      entry: 'desktop',
      entry_source: 'provider_settings',
      flow_id: clicked.flowId
    })

    await act(async () => window.dispatchEvent(new Event('focus')))

    await waitFor(() =>
      expect(analyticsEvents('cherryin_balance_increased')).toEqual([
        { event: 'cherryin_balance_increased', flowId: clicked.flowId }
      ])
    )
  })

  it('does not report a balance increase when the balance did not rise', async () => {
    const user = userEvent.setup()
    render(<CherryInOauth providerId="cherryin" />)

    await user.click(await screen.findByText('settings.provider.oauth.topup'))
    await act(async () => window.dispatchEvent(new Event('focus')))

    await waitFor(() =>
      expect(requestMock.mock.calls.filter(([route]) => route === 'cherryin.get_balance')).toHaveLength(2)
    )
    await act(async () => undefined)
    expect(analyticsEvents('cherryin_balance_increased')).toEqual([])
  })

  it.each([
    ['a cancellation', 'cancelled'],
    ['an error', 'failed']
  ])('reports a settings sign-in that ends with %s as %s', async (kind, result) => {
    // The component's IpcError class comes from the module graph re-imported in beforeEach.
    const { IpcError } = await import('@shared/ipc/errors/IpcError')
    const failure =
      kind === 'a cancellation' ? new IpcError(oauthErrorCodes.SIGN_IN_CANCELLED, 'cancelled') : new Error('down')
    providerState.signedIn = false
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'oauth.has_token') return false
      if (route === 'cherryin.sign_in') throw failure
      return undefined
    })
    const user = userEvent.setup()
    render(<CherryInOauth providerId="cherryin" />)

    await user.click(await screen.findByText('settings.provider.oauth.cherryIn.login_button'))

    await waitFor(() =>
      expect(analyticsEvents('cherryin_sign_in_result')).toEqual([
        { event: 'cherryin_sign_in_result', source: 'provider_settings', result, durationMs: expect.any(Number) }
      ])
    )
  })
})
