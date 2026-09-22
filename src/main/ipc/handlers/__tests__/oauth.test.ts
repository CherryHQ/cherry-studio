import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authorizeTokenDanceApiKeyMock } = vi.hoisted(() => ({
  authorizeTokenDanceApiKeyMock: vi.fn(() => Promise.resolve('td-key'))
}))
vi.mock('@main/services/tokenDanceOAuth', () => ({ authorizeTokenDanceApiKey: authorizeTokenDanceApiKeyMock }))

import { application } from '@application'
import { OAuthSignInCancelledError } from '@main/services/oauth/errors'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'

import { oauthHandlers } from '../oauth'

const runtimeService = {
  signIn: vi.fn(
    (_senderId: string | null, providerId: string): Promise<{ accountId: string | null; apiKeys?: string }> =>
      Promise.resolve({ accountId: `${providerId}-account` })
  ),
  joinActiveSignIn: vi.fn(() => Promise.resolve({ status: 'completed', account: { accountId: 'acc-1' } })),
  cancelSignIn: vi.fn(() => Promise.resolve()),
  hasToken: vi.fn(() => Promise.resolve(true)),
  getAccount: vi.fn(() => Promise.resolve({ accountId: 'acc-1' })),
  logout: vi.fn(() => Promise.resolve())
}

const codeCliService = {
  checkClaudeLogin: vi.fn(() => Promise.resolve(true))
}

const mainWindowService = {
  showMainWindow: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(application.get).mockImplementation((name: string) => {
    if (name === 'CodeCliService') return codeCliService as never
    if (name === 'MainWindowService') return mainWindowService as never
    if (name === 'OAuthRuntimeService') return runtimeService as never
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: 'w1' as const }
const provider = { providerId: 'codex' }
const signInObservation = { providerId: 'codex', requestId: 'request-1' }

describe('oauthHandlers', () => {
  it('returns the account and asks MainWindowService to raise the main window after sign-in', async () => {
    runtimeService.signIn.mockResolvedValueOnce({ accountId: 'codex-account', apiKeys: 'must-not-cross' })

    await expect(oauthHandlers['oauth.sign_in'](signInObservation, ctx)).resolves.toEqual({
      accountId: 'codex-account'
    })
    expect(runtimeService.signIn).toHaveBeenCalledWith('w1', 'codex', 'request-1', {})
    expect(mainWindowService.showMainWindow).toHaveBeenCalledOnce()
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
    expect(runtimeService.joinActiveSignIn).toHaveBeenCalledWith('w1', 'codex', 'request-1')
  })

  it('maps sign_in.attach cancellation to a stable IPC error', async () => {
    runtimeService.joinActiveSignIn.mockRejectedValueOnce(new OAuthSignInCancelledError('codex'))

    const error = await oauthHandlers['oauth.sign_in.attach'](signInObservation, ctx).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toHaveProperty('code', oauthErrorCodes.SIGN_IN_CANCELLED)
  })

  it('dispatches cancel_sign_in with the request id', async () => {
    await oauthHandlers['oauth.cancel_sign_in'](signInObservation, ctx)
    expect(runtimeService.cancelSignIn).toHaveBeenCalledWith('w1', 'codex', 'request-1')
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

  it('authorizes a TokenDance API key', async () => {
    await expect(oauthHandlers['oauth.tokendance.authorize_api_key'](undefined, ctx)).resolves.toBe('td-key')
    expect(authorizeTokenDanceApiKeyMock).toHaveBeenCalledOnce()
  })

  it('dispatches check_external_login to CodeCliService', async () => {
    await expect(oauthHandlers['oauth.check_external_login']({ providerId: 'claude-code' }, ctx)).resolves.toBe(true)
    expect(application.get).toHaveBeenCalledWith('CodeCliService')
    expect(codeCliService.checkClaudeLogin).toHaveBeenCalledTimes(1)
  })

  it('rejects check_external_login for a non-external-cli provider', () => {
    expect(() => oauthHandlers['oauth.check_external_login']({ providerId: 'codex' }, ctx)).toThrow(
      /Unsupported external-cli/
    )
    expect(codeCliService.checkClaudeLogin).not.toHaveBeenCalled()
  })
})
