import { ipcMain, net, shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { authorizeTokenDanceApiKeyMock } = vi.hoisted(() => ({
  authorizeTokenDanceApiKeyMock: vi.fn(() => Promise.resolve('td-key'))
}))
vi.mock('../ipcHandlers', async () => ({ ipcHandlers: (await import('../oauth')).oauthHandlers }))
vi.mock('@main/services/tokenDanceOAuth', () => ({ authorizeTokenDanceApiKey: authorizeTokenDanceApiKeyMock }))

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { IpcApiService } from '@main/ipc/IpcApiService'
import { OAuthSignInCancelledError, OAuthSignInFailureError } from '@main/services/oauth/errors'
import { LoopbackCallbackTransport } from '@main/services/oauth/runtime/LoopbackCallbackTransport'
import { OAuthRuntimeService } from '@main/services/oauth/runtime/OAuthRuntimeService'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'
import { IpcChannel } from '@shared/IpcChannel'

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
  BaseService.resetInstances()
  vi.mocked(application.getPath).mockReturnValue('/app')
  vi.mocked(application.get).mockImplementation((name: string) => {
    if (name === 'WindowManager') return { getWindowIdByWebContents: () => 'w1' } as never
    if (name === 'CodeCliService') return codeCliService as never
    if (name === 'MainWindowService') return mainWindowService as never
    if (name === 'OAuthRuntimeService') return runtimeService as never
    throw new Error(`Unexpected application.get(${name})`)
  })
})

afterEach(() => vi.restoreAllMocks())

async function requestEnvelope(route: string, input = signInObservation) {
  const ipc = new IpcApiService()
  ;(ipc as unknown as { onInit(): void }).onInit()
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === IpcChannel.IpcApi_Request)![1]
  const result = await handler(
    { sender: { getType: () => 'window' }, senderFrame: { url: 'file:///app/index.html', parent: null } } as never,
    route,
    input
  )
  return JSON.parse(JSON.stringify(result))
}

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

  it.each([
    ['oauth.sign_in', runtimeService.signIn],
    ['oauth.sign_in.attach', runtimeService.joinActiveSignIn],
    ['oauth.cancel_sign_in', runtimeService.cancelSignIn]
  ])('serializes classified failures through the real %s handler and IPC envelope', async (route, invoke) => {
    invoke.mockRejectedValueOnce(
      new OAuthSignInFailureError(
        { reason: 'http_error', phase: 'exchange', httpStatus: 400 },
        new Error('TOKEN_MARKER')
      )
    )
    expect(await requestEnvelope(route)).toEqual({
      ok: false,
      error: {
        code: 'OAUTH_SIGN_IN_FAILED',
        message: 'Provider sign-in failed',
        data: { reason: 'http_error', phase: 'exchange', httpStatus: 400 }
      }
    })
  })

  it.each([
    ['oauth.sign_in', runtimeService.signIn],
    ['oauth.sign_in.attach', runtimeService.joinActiveSignIn],
    ['oauth.cancel_sign_in', runtimeService.cancelSignIn]
  ])('converts synchronous invocation failures from %s without exposing their message', async (route, invoke) => {
    invoke.mockImplementationOnce(() => {
      throw new TypeError('TOKEN_MARKER')
    })
    expect(await requestEnvelope(route)).toEqual({
      ok: false,
      error: {
        code: 'OAUTH_SIGN_IN_FAILED',
        message: 'Provider sign-in failed',
        data: { reason: 'unknown' }
      }
    })
  })

  it('carries a real token HTTP failure through runtime, handler, router and IPC serialization', async () => {
    const runtime = new OAuthRuntimeService()
    vi.spyOn(LoopbackCallbackTransport.prototype, 'waitForAuthorizationCode').mockResolvedValue('CODE_MARKER')
    vi.mocked(shell.openExternal).mockResolvedValueOnce()
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response('TOKEN_MARKER', { status: 400 }))
    runtimeService.signIn.mockImplementationOnce((senderId, providerId) =>
      runtime.signIn(senderId, providerId, 'request-1')
    )
    expect(await requestEnvelope('oauth.sign_in', { providerId: 'openai-codex', requestId: 'request-1' })).toEqual({
      ok: false,
      error: {
        code: 'OAUTH_SIGN_IN_FAILED',
        message: 'Provider sign-in failed',
        data: { reason: 'http_error', phase: 'exchange', httpStatus: 400 }
      }
    })
  })

  it('classifies a missing provider definition before opening the browser', async () => {
    const runtime = new OAuthRuntimeService()
    runtimeService.signIn.mockImplementationOnce((senderId, providerId) =>
      runtime.signIn(senderId, providerId, 'request-1')
    )
    expect(await requestEnvelope('oauth.sign_in', { providerId: 'unregistered', requestId: 'request-1' })).toEqual({
      ok: false,
      error: {
        code: 'OAUTH_SIGN_IN_FAILED',
        message: 'Provider sign-in failed',
        data: { reason: 'provider_not_registered' }
      }
    })
  })

  it('redacts a failure when raising the main window after successful sign-in', async () => {
    mainWindowService.showMainWindow.mockImplementationOnce(() => {
      throw new Error('TOKEN_MARKER')
    })
    expect(await requestEnvelope('oauth.sign_in')).toEqual({
      ok: false,
      error: {
        code: 'OAUTH_SIGN_IN_FAILED',
        message: 'Provider sign-in failed',
        data: { reason: 'unknown' }
      }
    })
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
