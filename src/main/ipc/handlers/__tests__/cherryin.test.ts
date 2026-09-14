import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, cherryInOAuthService, runtimeService, windowManager, windowMock } = vi.hoisted(() => {
  const windowMock = {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  }
  return {
    appGetMock: vi.fn(),
    cherryInOAuthService: {
      getBalance: vi.fn(() => Promise.resolve({ balance: 1, profile: null })),
      logout: vi.fn(() => Promise.resolve())
    },
    runtimeService: {
      signIn: vi.fn(() => Promise.resolve({ accountId: null, apiKeys: 'sk-cherryin' }))
    },
    windowManager: { getWindow: vi.fn(() => windowMock) },
    windowMock
  }
})
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/services/oauth/CherryInOAuthService', () => ({ cherryInOAuthService }))

import { OAuthSignInCancelledError } from '@main/services/oauth/errors'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'

import { cherryinHandlers } from '../cherryin'

beforeEach(() => {
  vi.clearAllMocks()
  windowMock.isDestroyed.mockReturnValue(false)
  windowMock.isMinimized.mockReturnValue(false)
  appGetMock.mockImplementation((name: string) => (name === 'WindowManager' ? windowManager : runtimeService))
})

describe('cherryinHandlers', () => {
  it('returns provisioned API keys and focuses the initiating window after sign-in', async () => {
    windowMock.isMinimized.mockReturnValue(true)

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
    expect(windowMock.restore).toHaveBeenCalledOnce()
    expect(windowMock.show).toHaveBeenCalledOnce()
    expect(windowMock.focus).toHaveBeenCalledOnce()
  })

  it('maps sign-in cancellation to the shared OAuth IPC error', async () => {
    runtimeService.signIn.mockRejectedValueOnce(new OAuthSignInCancelledError('cherryin'))

    const error = await cherryinHandlers['cherryin.sign_in'](
      { requestId: 'request-1', oauthServer: 'https://open.cherryin.ai' },
      { senderId: 'w1' }
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toHaveProperty('code', oauthErrorCodes.SIGN_IN_CANCELLED)
    expect(windowMock.focus).not.toHaveBeenCalled()
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
