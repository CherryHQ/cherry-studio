import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cherryInOauthService } = vi.hoisted(() => ({
  cherryInOauthService: {
    getBalance: vi.fn(() =>
      Promise.resolve({ balance: 1, profile: null, monthlyUsageTokens: null, monthlySpend: null })
    ),
    logout: vi.fn(() => Promise.resolve())
  }
}))
vi.mock('@main/services/oauth/CherryInOauthService', () => ({ cherryInOauthService }))

import { cherryinHandlers } from '../cherryin'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cherryinHandlers', () => {
  it('dispatches get_balance to the service', async () => {
    await expect(
      cherryinHandlers['cherryin.get_balance']({ apiHost: 'https://open.cherryin.ai' }, { senderId: 'w1' })
    ).resolves.toEqual({ balance: 1, profile: null, monthlyUsageTokens: null, monthlySpend: null })
    expect(cherryInOauthService.getBalance).toHaveBeenCalledWith('https://open.cherryin.ai')
  })

  it('dispatches logout to the service', async () => {
    await cherryinHandlers['cherryin.logout']({ apiHost: 'https://open.cherryin.ai' }, { senderId: 'w1' })
    expect(cherryInOauthService.logout).toHaveBeenCalledWith('https://open.cherryin.ai')
  })
})
