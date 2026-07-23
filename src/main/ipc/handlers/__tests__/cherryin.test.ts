import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGet, cherryInOAuthService, endpointService } = vi.hoisted(() => ({
  appGet: vi.fn(),
  cherryInOAuthService: {
    getBalance: vi.fn(() => Promise.resolve({ balance: 1, profile: null })),
    logout: vi.fn(() => Promise.resolve())
  },
  endpointService: {
    getSelection: vi.fn(),
    setMode: vi.fn()
  }
}))
vi.mock('@application', () => ({ application: { get: appGet } }))
vi.mock('@main/services/oauth/CherryInOAuthService', () => ({ cherryInOAuthService }))

import { cherryinHandlers } from '../cherryin'

beforeEach(() => {
  vi.clearAllMocks()
  appGet.mockReturnValue(endpointService)
})

describe('cherryinHandlers', () => {
  it('dispatches endpoint selection commands', async () => {
    endpointService.getSelection.mockResolvedValue({ host: 'https://open.cherryin.net', mode: 'auto', source: 'probe' })
    endpointService.setMode.mockResolvedValue({ host: 'https://open.cherryin.ai', mode: 'global', source: 'manual' })

    await cherryinHandlers['cherryin.get_endpoint_selection'](undefined, { senderId: 'w1' })
    await cherryinHandlers['cherryin.set_host_mode']({ mode: 'global' }, { senderId: 'w1' })

    expect(endpointService.getSelection).toHaveBeenCalledOnce()
    expect(endpointService.setMode).toHaveBeenCalledWith('global')
  })

  it('dispatches get_balance to the service', async () => {
    await expect(
      cherryinHandlers['cherryin.get_balance']({ apiHost: 'https://open.cherryin.ai' }, { senderId: 'w1' })
    ).resolves.toEqual({ balance: 1, profile: null })
    expect(cherryInOAuthService.getBalance).toHaveBeenCalledWith('https://open.cherryin.ai')
  })

  it('dispatches logout to the service', async () => {
    await cherryinHandlers['cherryin.logout']({ apiHost: 'https://open.cherryin.ai' }, { senderId: 'w1' })
    expect(cherryInOAuthService.logout).toHaveBeenCalledWith('https://open.cherryin.ai')
  })
})
