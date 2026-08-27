import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { OAuthSignInCancelledError } from '@main/services/oauth/errors'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'

import { oauthHandlers } from '../oauth'

const runtimeService = {
  signIn: vi.fn((providerId: string) => Promise.resolve({ accountId: `${providerId}-account` })),
  joinActiveSignIn: vi.fn(() => Promise.resolve({ status: 'completed', account: { accountId: 'acc-1' } })),
  cancelSignIn: vi.fn(() => Promise.resolve()),
  hasToken: vi.fn(() => Promise.resolve(true)),
  getAccount: vi.fn(() => Promise.resolve({ accountId: 'acc-1' })),
  logout: vi.fn(() => Promise.resolve()),
  startDeepLinkFlow: vi.fn(() => Promise.resolve({ authUrl: 'https://open.cherryin.ai/auth', state: 'st' }))
}

const codeCliService = {
  checkClaudeLogin: vi.fn(() => Promise.resolve(true))
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => (name === 'CodeCliService' ? codeCliService : runtimeService))
})

const ctx = { senderId: 'w1' as const }
const provider = { providerId: 'codex' }
const signInObservation = { providerId: 'codex', requestId: 'request-1' }

describe('oauthHandlers', () => {
  it('dispatches sign_in to OAuthRuntimeService with the provider and request ids', async () => {
    await expect(oauthHandlers['oauth.sign_in'](signInObservation, ctx)).resolves.toEqual({
      accountId: 'codex-account'
    })
    expect(appGetMock).toHaveBeenCalledWith('OAuthRuntimeService')
    expect(runtimeService.signIn).toHaveBeenCalledWith('codex', 'request-1')
  })

  it('maps sign_in cancellation to a stable IPC error', async () => {
    runtimeService.signIn.mockRejectedValueOnce(new OAuthSignInCancelledError('codex'))

    const error = await oauthHandlers['oauth.sign_in'](signInObservation, ctx).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toHaveProperty('code', oauthErrorCodes.SIGN_IN_CANCELLED)
  })

  it('dispatches sign_in.attach to OAuthRuntimeService with the provider and request ids', async () => {
    await expect(oauthHandlers['oauth.sign_in.attach'](signInObservation, ctx)).resolves.toEqual({
      status: 'completed',
      account: { accountId: 'acc-1' }
    })
    expect(runtimeService.joinActiveSignIn).toHaveBeenCalledWith('codex', 'request-1')
  })

  it('maps sign_in.attach cancellation to a stable IPC error', async () => {
    runtimeService.joinActiveSignIn.mockRejectedValueOnce(new OAuthSignInCancelledError('codex'))

    const error = await oauthHandlers['oauth.sign_in.attach'](signInObservation, ctx).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toHaveProperty('code', oauthErrorCodes.SIGN_IN_CANCELLED)
  })

  it('dispatches cancel_sign_in with the request id', async () => {
    await oauthHandlers['oauth.cancel_sign_in'](signInObservation, ctx)
    expect(runtimeService.cancelSignIn).toHaveBeenCalledWith('codex', 'request-1')
  })

  it('dispatches has_token to OAuthRuntimeService', async () => {
    await expect(oauthHandlers['oauth.has_token'](provider, ctx)).resolves.toBe(true)
    expect(runtimeService.hasToken).toHaveBeenCalledWith('codex')
  })

  it('dispatches get_account to OAuthRuntimeService', async () => {
    await expect(oauthHandlers['oauth.get_account'](provider, ctx)).resolves.toEqual({ accountId: 'acc-1' })
    expect(runtimeService.getAccount).toHaveBeenCalledWith('codex')
  })

  it('dispatches logout to OAuthRuntimeService', async () => {
    await oauthHandlers['oauth.logout'](provider, ctx)
    expect(runtimeService.logout).toHaveBeenCalledWith('codex')
  })

  it('dispatches check_external_login to CodeCliService', async () => {
    await expect(oauthHandlers['oauth.check_external_login']({ providerId: 'claude-code' }, ctx)).resolves.toBe(true)
    expect(appGetMock).toHaveBeenCalledWith('CodeCliService')
    expect(codeCliService.checkClaudeLogin).toHaveBeenCalledTimes(1)
  })

  it('rejects check_external_login for a non-external-cli provider', () => {
    expect(() => oauthHandlers['oauth.check_external_login']({ providerId: 'codex' }, ctx)).toThrow(
      /Unsupported external-cli/
    )
    expect(codeCliService.checkClaudeLogin).not.toHaveBeenCalled()
  })

  it('forwards the initiator window id, provider, and hosts to startDeepLinkFlow', async () => {
    await expect(
      oauthHandlers['oauth.start_deep_link_flow'](
        { providerId: 'cherryin', oauthServer: 'https://open.cherryin.ai', apiHost: 'https://api.cherryin.ai' },
        ctx
      )
    ).resolves.toEqual({ authUrl: 'https://open.cherryin.ai/auth', state: 'st' })
    expect(runtimeService.startDeepLinkFlow).toHaveBeenCalledWith('w1', 'cherryin', {
      oauthServer: 'https://open.cherryin.ai',
      apiHost: 'https://api.cherryin.ai'
    })
  })

  // apiHost falls back to oauthServer; a null senderId (source-trust caller with
  // no window) passes through so the runtime rejects it.
  it('defaults apiHost to oauthServer and passes a null senderId through', async () => {
    await oauthHandlers['oauth.start_deep_link_flow'](
      { providerId: 'cherryin', oauthServer: 'https://open.cherryin.ai' },
      { senderId: null }
    )
    expect(runtimeService.startDeepLinkFlow).toHaveBeenCalledWith(null, 'cherryin', {
      oauthServer: 'https://open.cherryin.ai',
      apiHost: 'https://open.cherryin.ai'
    })
  })
})
