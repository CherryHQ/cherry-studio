import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { cherryinHandlers } from '../cherryin'

const cherryInService = {
  getBalance: vi.fn(() => Promise.resolve({ balance: 1, profile: null, monthlyUsageTokens: null, monthlySpend: null })),
  logout: vi.fn(() => Promise.resolve())
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockReturnValue(cherryInService)
})

describe('cherryinHandlers', () => {
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
