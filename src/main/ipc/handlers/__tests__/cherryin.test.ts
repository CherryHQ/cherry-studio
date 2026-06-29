import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { cherryinHandlers } from '../cherryin'

const cherryInService = {
  startOAuthFlow: vi.fn(() => Promise.resolve({ authUrl: 'https://open.cherryin.ai/auth', state: 'st' })),
  getBalance: vi.fn(() => Promise.resolve({ balance: 1, profile: null, monthlyUsageTokens: null, monthlySpend: null })),
  logout: vi.fn(() => Promise.resolve())
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockReturnValue(cherryInService)
})

describe('cherryinHandlers', () => {
  it('forwards the initiator window id and apiHost to startOAuthFlow', async () => {
    await expect(
      cherryinHandlers['cherryin.start_oauth_flow'](
        { oauthServer: 'https://open.cherryin.ai', apiHost: 'https://api.cherryin.ai' },
        { senderId: 'w1' }
      )
    ).resolves.toEqual({ authUrl: 'https://open.cherryin.ai/auth', state: 'st' })
    expect(appGetMock).toHaveBeenCalledWith('CherryInOauthService')
    expect(cherryInService.startOAuthFlow).toHaveBeenCalledWith(
      'w1',
      'https://open.cherryin.ai',
      'https://api.cherryin.ai'
    )
  })

  // A source-trust caller has no window; pass null through so the service rejects it.
  it('passes a null senderId through to startOAuthFlow', async () => {
    await cherryinHandlers['cherryin.start_oauth_flow']({ oauthServer: 'https://open.cherryin.ai' }, { senderId: null })
    expect(cherryInService.startOAuthFlow).toHaveBeenCalledWith(null, 'https://open.cherryin.ai', undefined)
  })

  it('dispatches get_balance to the service', async () => {
    await expect(
      cherryinHandlers['cherryin.get_balance']({ apiHost: 'https://open.cherryin.ai' }, { senderId: 'w1' })
    ).resolves.toEqual({ balance: 1, profile: null, monthlyUsageTokens: null, monthlySpend: null })
    expect(cherryInService.getBalance).toHaveBeenCalledWith('https://open.cherryin.ai')
  })

  it('dispatches logout to the service', async () => {
    await cherryinHandlers['cherryin.logout']({ apiHost: 'https://open.cherryin.ai' }, { senderId: 'w1' })
    expect(cherryInService.logout).toHaveBeenCalledWith('https://open.cherryin.ai')
  })
})
