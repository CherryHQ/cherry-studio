import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FEISHU_REQUIRED_USER_SCOPES,
  FeishuProviderError,
  beginDeviceAuthorization,
  exchangeDeviceAuthorization,
  getUserIdentity,
  refreshUserToken,
  revokeUserToken
} from '../feishuKnowledgeProvider'

function response(body: unknown, options: { status?: number; headers?: Record<string, string>; empty?: boolean } = {}) {
  const status = options.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(options.headers),
    text: async () => (options.empty ? '' : JSON.stringify(body))
  } as Response
}

describe('feishuKnowledgeProvider', () => {
  beforeEach(() => vi.mocked(net.fetch).mockReset())
  afterEach(() => vi.restoreAllMocks())

  it('starts device authorization with all required user scopes', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(
      response({
        device_code: 'device-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://accounts.feishu.cn/oauth/v1/device/verify',
        verification_uri_complete: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expires_in: 600,
        interval: 5
      })
    )
    const signal = new AbortController().signal

    const result = await beginDeviceAuthorization({ appId: 'cli_test', appSecret: 'secret-sentinel' }, signal)

    expect(result).toEqual({
      deviceCode: 'device-code',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
      expiresIn: 600,
      interval: 5
    })
    const [, init] = vi.mocked(net.fetch).mock.calls[0]
    expect(init?.signal).toEqual(expect.any(AbortSignal))
    expect(init?.body?.toString()).toBe(
      new URLSearchParams({ client_id: 'cli_test', scope: FEISHU_REQUIRED_USER_SCOPES.join(' ') }).toString()
    )
  })

  it('uses the actual token response scopes and rotates both tokens', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(
        response({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 7200,
          refresh_token_expires_in: 604800,
          scope: FEISHU_REQUIRED_USER_SCOPES.join(' ')
        })
      )
      .mockResolvedValueOnce(
        response({
          code: 0,
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_in: 7200,
          refresh_token_expires_in: 604800,
          scope: FEISHU_REQUIRED_USER_SCOPES.join(' ')
        })
      )

    const exchanged = await exchangeDeviceAuthorization({ appId: 'cli_test', appSecret: 'app-secret' }, 'device-code')
    const refreshed = await refreshUserToken({ appId: 'cli_test', appSecret: 'app-secret' }, exchanged.refreshToken)

    expect(exchanged.grantedScopes).toEqual([...FEISHU_REQUIRED_USER_SCOPES])
    expect(refreshed).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' })
  })

  it('classifies an application scope failure without leaking the provider body', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(
      response({ error: 'invalid_scope', error_description: 'secret-sentinel is not configured' }, { status: 400 })
    )

    const error = await beginDeviceAuthorization({ appId: 'cli_test', appSecret: 'app-secret' }).catch(
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(FeishuProviderError)
    expect(error).toMatchObject({ code: 'app-scope-missing', terminal: true })
    expect((error as Error).message).not.toContain('secret-sentinel')
  })

  it('classifies invalid refresh grants as terminal reauthorization failures', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(
      response({ code: 20029, error: 'invalid_grant', error_description: 'refresh-token-sentinel' }, { status: 400 })
    )

    const error = await refreshUserToken(
      { appId: 'cli_test', appSecret: 'app-secret' },
      'refresh-token-sentinel'
    ).catch((cause: unknown) => cause)

    expect(error).toMatchObject({ code: 'reauthorization-required', terminal: true })
    expect(JSON.stringify(error)).not.toContain('refresh-token-sentinel')
  })

  it('returns user and tenant identity without token material', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(
      response({
        code: 0,
        data: {
          user_id: 'user_account',
          open_id: 'ou_account',
          union_id: 'on_union',
          tenant_key: 'tenant-key',
          name: 'Alice',
          avatar_url: 'https://example.com/avatar.png'
        }
      })
    )

    await expect(getUserIdentity('access-token-sentinel')).resolves.toEqual({
      accountUserId: 'user_account',
      accountOpenId: 'ou_account',
      accountUnionId: 'on_union',
      tenantKey: 'tenant-key',
      displayName: 'Alice',
      avatarUrl: 'https://example.com/avatar.png'
    })
  })

  it('classifies a missing user_id as identity-unverifiable', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(
      response({
        code: 0,
        data: {
          open_id: 'ou_account',
          tenant_key: 'tenant-key'
        }
      })
    )

    await expect(getUserIdentity('access-token')).rejects.toMatchObject({
      code: 'identity-unverifiable',
      terminal: true
    })
  })

  it('accepts the empty successful revoke response', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(response(null, { empty: true }))

    await expect(
      revokeUserToken({ appId: 'cli_test', appSecret: 'app-secret' }, 'refresh-token')
    ).resolves.toBeUndefined()
  })

  it('carries Retry-After as transient retry metadata', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(
      response({ code: 99991663, msg: 'rate limit' }, { status: 429, headers: { 'Retry-After': '3' } })
    )

    const error = await getUserIdentity('access-token').catch((cause: unknown) => cause)

    expect(error).toMatchObject({ code: 'transient', terminal: false, retryAfterMs: 3000 })
  })

  it('keeps non-JSON service failures retryable', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(response('gateway unavailable', { status: 503 }))

    const error = await getUserIdentity('access-token').catch((cause: unknown) => cause)

    expect(error).toMatchObject({ code: 'transient', terminal: false })
  })

  it('classifies the internal request timeout as transient', async () => {
    const timeoutController = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeoutController.signal)
    let observedSignal: AbortSignal | null | undefined
    vi.mocked(net.fetch).mockImplementationOnce((_url, init) => {
      observedSignal = init?.signal
      return new Promise((_resolve, reject) => {
        timeoutController.signal.addEventListener('abort', () => reject(timeoutController.signal.reason), {
          once: true
        })
      })
    })
    const request = getUserIdentity('access-token').catch((cause: unknown) => cause)
    await vi.waitFor(() => expect(net.fetch).toHaveBeenCalledOnce())

    timeoutController.abort(new DOMException('request timeout', 'TimeoutError'))
    const error = await request

    expect(observedSignal).toBe(timeoutController.signal)
    expect(error).toMatchObject({ code: 'transient', terminal: false })
  })

  it('preserves caller cancellation when it wins the combined request signal', async () => {
    const caller = new AbortController()
    const timeoutController = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeoutController.signal)
    vi.mocked(net.fetch).mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
    )
    const request = getUserIdentity('access-token', caller.signal).catch((cause: unknown) => cause)
    await vi.waitFor(() => expect(net.fetch).toHaveBeenCalledOnce())
    const cancellation = new DOMException('caller cancelled', 'AbortError')

    caller.abort(cancellation)

    await expect(request).resolves.toBe(cancellation)
  })
})
