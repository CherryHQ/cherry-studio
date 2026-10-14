import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cherryInOAuthService, runtimeService } = vi.hoisted(() => ({
  cherryInOAuthService: {
    getBalance: vi.fn(() => Promise.resolve({ balance: 1, profile: null })),
    logout: vi.fn(() => Promise.resolve())
  },
  runtimeService: {
    signIn: vi.fn(() => Promise.resolve({ accountId: null, apiKeys: 'sk-cherryin' }))
  }
}))
vi.mock('@main/services/oauth/CherryInOAuthService', () => ({ cherryInOAuthService }))

import { application } from '@application'
import { OAuthSignInCancelledError } from '@main/services/oauth/errors'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'

import { cherryinHandlers } from '../cherryin'

const mainWindowService = {
  showMainWindow: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(application.get).mockImplementation((name: string) => {
    if (name === 'MainWindowService') return mainWindowService as never
    if (name === 'OAuthRuntimeService') return runtimeService as never
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('cherryinHandlers', () => {
  it('returns provisioned API keys and asks MainWindowService to raise the main window after sign-in', async () => {
    await expect(
      cherryinHandlers['cherryin.sign_in'](
        {
          requestId: 'request-1',
          oauthServer: 'https://open.cherryin.ai',
          apiHost: 'https://open.cherryin.ai'
        },
        { senderId: 'w1' }
      )
    ).resolves.toEqual({ apiKeys: 'sk-cherryin' })
    expect(runtimeService.signIn).toHaveBeenCalledWith('w1', 'cherryin', 'request-1', {
      oauthServer: 'https://open.cherryin.ai',
      apiHost: 'https://open.cherryin.ai'
    })
    expect(mainWindowService.showMainWindow).toHaveBeenCalledOnce()
  })

  it('maps sign-in cancellation to the shared OAuth IPC error', async () => {
    runtimeService.signIn.mockRejectedValueOnce(new OAuthSignInCancelledError('cherryin'))

    const error = await cherryinHandlers['cherryin.sign_in'](
      { requestId: 'request-1', oauthServer: 'https://open.cherryin.ai' },
      { senderId: 'w1' }
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toHaveProperty('code', oauthErrorCodes.SIGN_IN_CANCELLED)
    expect(mainWindowService.showMainWindow).not.toHaveBeenCalled()
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
