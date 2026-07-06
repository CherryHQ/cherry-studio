import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const providerStore = new Map<string, { authConfig?: unknown; isEnabled?: boolean }>()
  const refreshMock = vi.fn()
  const afterPersistMock = vi.fn()
  return {
    providerStore,
    refreshMock,
    afterPersistMock,
    // One controllable fake OAuth client shared by every provider definition.
    clientMock: {
      refresh: refreshMock,
      createAuthorizationRequest: vi.fn(() => ({ authUrl: 'https://auth/x', state: 'st', codeVerifier: 'cv' })),
      exchangeCode: vi.fn()
    },
    transportMock: {
      tryAcquire: vi.fn(() => true),
      waitForAuthorizationCode: vi.fn(async () => 'auth-code'),
      close: vi.fn()
    },
    deepLinkTransportMock: {
      registerAuthorizationRequest: vi.fn(() => ({ authUrl: 'https://auth/x', state: 'st' })),
      consumeCallback: vi.fn(),
      getInitiatorWindowId: vi.fn(() => 'win-1'),
      sendConsumedResult: vi.fn(),
      close: vi.fn()
    },
    providerServiceMock: {
      getAuthConfig: vi.fn((id: string) => providerStore.get(id)?.authConfig ?? null),
      update: vi.fn((id: string, patch: Record<string, unknown>) => {
        providerStore.set(id, { ...providerStore.get(id), ...patch })
      })
    }
  }
})

vi.mock('@data/services/ProviderService', () => ({ providerService: h.providerServiceMock }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@main/core/lifecycle', () => ({
  BaseService: class {},
  Injectable: () => (target: unknown) => target,
  ServicePhase: () => (target: unknown) => target,
  Phase: { WhenReady: 'whenReady' }
}))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, net: { fetch: vi.fn() } }))
vi.mock('@application', () => ({ application: { get: vi.fn() } }))
vi.mock('../LoopbackCallbackTransport', () => ({ LoopbackCallbackTransport: vi.fn(() => h.transportMock) }))
vi.mock('../DeepLinkCallbackTransport', () => ({ DeepLinkCallbackTransport: vi.fn(() => h.deepLinkTransportMock) }))

// codex = OAuth-only loopback (clear disables); cherryin = deep-link with a
// manual API-key fallback (clear must NOT disable). Both share the fake client.
vi.mock('../providerDefinitions', () => ({
  oauthProviderDefinitions: {
    codex: {
      providerId: 'codex',
      clientId: 'codex-client',
      clearDisablesProvider: true,
      transport: {
        type: 'loopback',
        config: { hosts: ['127.0.0.1'], port: 0, path: '/cb', redirectUri: 'http://127.0.0.1/cb' }
      },
      createClient: () => h.clientMock,
      extractAccountId: () => null
    },
    cherryin: {
      providerId: 'cherryin',
      clientId: 'cherryin-client',
      transport: { type: 'deep-link', config: { redirectUri: 'app://cb' } },
      createClient: () => h.clientMock,
      afterPersistTokens: (tokenData: unknown, context: unknown) => h.afterPersistMock(tokenData, context)
    }
  }
}))

import { OAuthTransientError } from '../../errors'
import { OAuthRuntimeService } from '../OAuthRuntimeService'
import { OAuthHttpError } from '../PkceOAuthClient'

function seedOAuth(id: string, authConfig: Record<string, unknown>): void {
  h.providerStore.set(id, { authConfig: { type: 'oauth', clientId: 'x', ...authConfig } })
}

const FUTURE = () => Date.now() + 1_000_000
const PAST = () => Date.now() - 1_000

describe('OAuthRuntimeService', () => {
  let service: OAuthRuntimeService

  beforeEach(() => {
    h.providerStore.clear()
    vi.clearAllMocks()
    h.refreshMock.mockReset()
    h.afterPersistMock.mockReset()
    service = new OAuthRuntimeService()
  })

  it('returns a still-valid token without refreshing', async () => {
    seedOAuth('codex', { accessToken: 'tok', expiresAt: FUTURE(), accountId: 'acc' })
    expect(await service.getValidAccessToken('codex')).toEqual({ accessToken: 'tok', accountId: 'acc' })
    expect(h.refreshMock).not.toHaveBeenCalled()
  })

  // W1 + item4: a transient refresh failure must NOT log the user out, and must
  // surface a retriable error rather than a null the caller reads as signed-out.
  it('throws a transient error and keeps the stored token when a refresh fails transiently (network/5xx)', async () => {
    seedOAuth('codex', { accessToken: 'old', refreshToken: 'r', expiresAt: PAST() })
    h.refreshMock.mockRejectedValue(new Error('network down'))

    await expect(service.getValidAccessToken('codex')).rejects.toThrow(OAuthTransientError)
    const stored = h.providerStore.get('codex')
    expect(stored?.authConfig).toMatchObject({ type: 'oauth', refreshToken: 'r' })
    expect(stored?.isEnabled).toBeUndefined()
  })

  // A 408 from the token endpoint is transient too — must keep the session.
  it('throws a transient error and keeps the stored token when a refresh returns 408 (request timeout)', async () => {
    seedOAuth('codex', { accessToken: 'old', refreshToken: 'r', expiresAt: PAST() })
    h.refreshMock.mockRejectedValue(new OAuthHttpError('timeout', 408, ''))

    await expect(service.getValidAccessToken('codex')).rejects.toThrow(OAuthTransientError)
    expect(h.providerStore.get('codex')?.authConfig).toMatchObject({ type: 'oauth' })
  })

  // W1 terminal + B1: a rejected refresh token clears the session, and codex
  // (OAuth-only) is also disabled.
  it('clears and disables an OAuth-only provider when the refresh token is rejected (4xx)', async () => {
    seedOAuth('codex', { accessToken: 'old', refreshToken: 'r', expiresAt: PAST() })
    h.refreshMock.mockRejectedValue(new OAuthHttpError('bad', 400, '{"error":"invalid_grant"}'))

    expect(await service.getValidAccessToken('codex')).toBeNull()
    const stored = h.providerStore.get('codex')
    expect(stored?.authConfig).toEqual({ type: 'api-key' })
    expect(stored?.isEnabled).toBe(false)
  })

  // B1: the same terminal clear for a provider with a manual key must keep it enabled.
  it('clears but does NOT disable a provider that can hold a manual API key', async () => {
    seedOAuth('cherryin', { accessToken: 'old', refreshToken: 'r', expiresAt: PAST() })
    h.refreshMock.mockRejectedValue(new OAuthHttpError('bad', 400, '{}'))

    expect(await service.getValidAccessToken('cherryin')).toBeNull()
    const stored = h.providerStore.get('cherryin')
    expect(stored?.authConfig).toEqual({ type: 'api-key' })
    expect(stored?.isEnabled).toBeUndefined()
  })

  // B1 race: a logout that lands while a refresh is in flight must win — the
  // late refresh must not resurrect the session, and no token is handed out.
  it('does not resurrect the session when a logout races an in-flight refresh', async () => {
    seedOAuth('codex', { accessToken: 'old', refreshToken: 'r', expiresAt: PAST() })
    h.refreshMock.mockImplementation(async () => {
      // Simulate the user logging out during the token endpoint round-trip.
      await service.logout('codex')
      return { access_token: 'resurrected', refresh_token: 'r2', expires_in: 3600 }
    })

    expect(await service.getValidAccessToken('codex')).toBeNull()
    expect(h.providerStore.get('codex')?.authConfig).toEqual({ type: 'api-key' })
  })

  // B1 race, cross-session: logout → re-login installs a NEW oauth session while
  // the old refresh is in flight. The stale refresh must not clobber the new
  // login (same `type:'oauth'`, different refresh token).
  it('does not clobber a re-login that races an in-flight refresh, and fails the stale request closed', async () => {
    seedOAuth('codex', { accessToken: 'old', refreshToken: 'r', expiresAt: PAST() })
    h.refreshMock.mockImplementation(async () => {
      // Simulate logout + a fresh sign-in during the token endpoint round-trip.
      seedOAuth('codex', { accessToken: 'new-login', refreshToken: 'r-new', expiresAt: FUTURE() })
      return { access_token: 'stale', refresh_token: 'r2', expires_in: 3600 }
    })

    // The stale refresh must neither persist nor hand its token (nor the new
    // session's) to this in-flight request — fail closed so it retries cleanly.
    expect(await service.getValidAccessToken('codex')).toBeNull()
    // The new login is left intact, never overwritten by the stale refresh.
    expect(h.providerStore.get('codex')?.authConfig).toMatchObject({ accessToken: 'new-login', refreshToken: 'r-new' })
  })

  // Dedup must be per-session: a re-login's own refresh must not reuse (and act
  // on the terminal result of) the superseded session's in-flight refresh, which
  // would clear the freshly-installed session.
  it('does not reuse a superseded session refresh for a re-logged-in session', async () => {
    seedOAuth('codex', { accessToken: 'old', refreshToken: 'r-old', expiresAt: PAST() })
    let resolveOld: (v: unknown) => void = () => {}
    const oldRefresh = new Promise((res) => {
      resolveOld = res
    })
    h.refreshMock.mockImplementation(async (token: string) => {
      if (token === 'r-old') {
        await oldRefresh
        throw new OAuthHttpError('bad', 400, '{"error":"invalid_grant"}') // old session terminally fails
      }
      return { access_token: 'fresh-new', refresh_token: 'r-new2', expires_in: 3600 } // new session refreshes fine
    })

    // Kick off the old-session refresh (hangs on the network).
    const oldCall = service.getValidAccessToken('codex')
    // A re-login installs a new session, then its own request forces a refresh.
    seedOAuth('codex', { accessToken: 'new-login', refreshToken: 'r-new', expiresAt: PAST() })
    const newToken = await service.getValidAccessToken('codex', { forceRefresh: true })

    // The new session got its OWN refresh, not the old (terminal) one.
    expect(newToken).toEqual({ accessToken: 'fresh-new', accountId: null })
    expect(h.providerStore.get('codex')?.authConfig).toMatchObject({ type: 'oauth', accessToken: 'fresh-new' })

    // Now let the old refresh finish terminally — it must not clear the new session.
    resolveOld(undefined)
    await oldCall
    expect(h.providerStore.get('codex')?.authConfig).toMatchObject({ type: 'oauth', accessToken: 'fresh-new' })
  })

  // A terminal failure of the OLD refresh must not tear down a session a
  // re-login installed while that refresh was in flight.
  it('does not clear a re-login when the old refresh fails terminally', async () => {
    seedOAuth('codex', { accessToken: 'old', refreshToken: 'r', expiresAt: PAST() })
    h.refreshMock.mockImplementation(async () => {
      seedOAuth('codex', { accessToken: 'new-login', refreshToken: 'r-new', expiresAt: FUTURE() })
      throw new OAuthHttpError('bad', 400, '{"error":"invalid_grant"}')
    })

    expect(await service.getValidAccessToken('codex')).toBeNull()
    const stored = h.providerStore.get('codex')
    expect(stored?.authConfig).toMatchObject({ type: 'oauth', accessToken: 'new-login', refreshToken: 'r-new' })
    expect(stored?.isEnabled).not.toBe(false)
  })

  it('deduplicates concurrent refreshes', async () => {
    seedOAuth('codex', { accessToken: 'old', refreshToken: 'r', expiresAt: PAST() })
    h.refreshMock.mockResolvedValue({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 })

    const [a, b] = await Promise.all([service.getValidAccessToken('codex'), service.getValidAccessToken('codex')])
    expect(h.refreshMock).toHaveBeenCalledTimes(1)
    expect(a?.accessToken).toBe('new')
    expect(b?.accessToken).toBe('new')
  })

  // W3: a server-revoked token 401s before local expiry; authenticatedFetch
  // force-refreshes and retries once with the fresh token.
  it('authenticatedFetch retries once on 401 with a refreshed token', async () => {
    seedOAuth('codex', { accessToken: 'tok', refreshToken: 'r', expiresAt: FUTURE(), accountId: null })
    h.refreshMock.mockResolvedValue({ access_token: 'tok2', refresh_token: 'r2', expires_in: 3600 })

    const doFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, body: { cancel: vi.fn() } } as unknown as Response)
      .mockResolvedValueOnce({ status: 200 } as Response)
    const tokensSeen: string[] = []
    const buildRequest = (creds: { accessToken: string }) => {
      tokensSeen.push(creds.accessToken)
      return { input: 'http://example/api', init: {} }
    }

    const res = await service.authenticatedFetch('codex', buildRequest, doFetch)
    expect(res.status).toBe(200)
    expect(doFetch).toHaveBeenCalledTimes(2)
    expect(tokensSeen).toEqual(['tok', 'tok2'])
  })

  it('authenticatedFetch throws the supplied hint when not signed in', async () => {
    await expect(
      service.authenticatedFetch('codex', () => ({ input: 'x', init: {} }), vi.fn(), {
        notSignedInMessage: 'please sign in'
      })
    ).rejects.toThrow('please sign in')
  })

  // item4: a transient refresh blip mid-chat must surface as a retriable error,
  // NOT the not-signed-in hint (which would push the user through a full OAuth
  // round). The request is never even attempted.
  it('authenticatedFetch surfaces a transient refresh failure instead of the not-signed-in hint', async () => {
    seedOAuth('codex', { accessToken: 'old', refreshToken: 'r', expiresAt: PAST() })
    h.refreshMock.mockRejectedValue(new Error('network down'))
    const doFetch = vi.fn()

    await expect(
      service.authenticatedFetch('codex', () => ({ input: 'x', init: {} }), doFetch, {
        notSignedInMessage: 'please sign in'
      })
    ).rejects.toThrow(OAuthTransientError)
    expect(doFetch).not.toHaveBeenCalled()
  })

  // item4 + resource safety: when the forced refresh after a 401 fails
  // transiently, the transient error propagates AND the discarded 401 body is
  // drained so the undici connection is not leaked.
  it('authenticatedFetch drains the 401 body when the forced refresh fails transiently', async () => {
    seedOAuth('codex', { accessToken: 'tok', refreshToken: 'r', expiresAt: FUTURE(), accountId: null })
    h.refreshMock.mockRejectedValue(new Error('network down'))
    const cancel = vi.fn()
    const doFetch = vi.fn().mockResolvedValue({ status: 401, body: { cancel } } as unknown as Response)

    await expect(service.authenticatedFetch('codex', () => ({ input: 'x', init: {} }), doFetch)).rejects.toThrow(
      OAuthTransientError
    )
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(doFetch).toHaveBeenCalledTimes(1)
  })

  // CherryIN path: still 401 after the forced-refresh retry → onUnauthorized fires
  // once with the final response, and the 401 is returned (not thrown) for the
  // caller to surface. `context` is accepted and threaded into token refresh.
  it('authenticatedFetch reports a persistent 401 to onUnauthorized and returns it', async () => {
    seedOAuth('cherryin', { accessToken: 'tok', refreshToken: 'r', expiresAt: FUTURE(), accountId: null })
    h.refreshMock.mockResolvedValue({ access_token: 'tok2', refresh_token: 'r2', expires_in: 3600 })

    const doFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, body: { cancel: vi.fn() } } as unknown as Response)
      .mockResolvedValueOnce({ status: 401 } as Response)
    const onUnauthorized = vi.fn()

    const res = await service.authenticatedFetch(
      'cherryin',
      () => ({ input: 'http://example/api', init: {} }),
      doFetch,
      {
        context: { apiHost: 'https://open.cherryin.ai' },
        onUnauthorized
      }
    )

    expect(res.status).toBe(401)
    expect(doFetch).toHaveBeenCalledTimes(2)
    expect(h.refreshMock).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  // B1 via logout: codex disables, cherryin stays enabled.
  it('logout disables an OAuth-only provider but not one with a manual key', async () => {
    seedOAuth('codex', { accessToken: 'tok' })
    await service.logout('codex')
    expect(h.providerStore.get('codex')?.isEnabled).toBe(false)

    seedOAuth('cherryin', { accessToken: 'tok' })
    await service.logout('cherryin')
    expect(h.providerStore.get('cherryin')?.isEnabled).toBeUndefined()
  })

  // The loopback happy path: exchange the code, persist tokens, enable the
  // provider, and always release the transport.
  it('signIn persists tokens, enables the provider, and closes the transport', async () => {
    h.clientMock.exchangeCode.mockResolvedValue({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })

    const account = await service.signIn('codex')

    const stored = h.providerStore.get('codex')
    expect(stored?.authConfig).toMatchObject({ accessToken: 'at' })
    expect(stored?.isEnabled).toBe(true)
    expect(account).toEqual({ accountId: null })
    expect(h.transportMock.close).toHaveBeenCalled()
  })

  // W2: tryAcquire already reserved — a second concurrent sign-in is refused.
  it('signIn rejects when a flow is already in progress', async () => {
    h.transportMock.tryAcquire.mockReturnValueOnce(false)
    await expect(service.signIn('codex')).rejects.toThrow(/already in progress/)
  })

  it('handleDeepLinkCallback exchanges, persists, and notifies the initiator', async () => {
    await service.startDeepLinkFlow('win-1', 'cherryin', {})
    h.deepLinkTransportMock.consumeCallback.mockReturnValue({
      code: 'c',
      codeVerifier: 'v',
      state: 'st',
      initiatorWindowId: 'win-1',
      context: {}
    })
    h.clientMock.exchangeCode.mockResolvedValue({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })

    await service.handleDeepLinkCallback(new URL('app://cb?state=st&code=c'))

    expect(h.providerStore.get('cherryin')?.authConfig).toMatchObject({ accessToken: 'at' })
    expect(h.deepLinkTransportMock.sendConsumedResult).toHaveBeenCalledWith('st', 'win-1', { apiKeys: '' })
  })

  it('handleDeepLinkCallback reports an exchange failure to the initiator', async () => {
    await service.startDeepLinkFlow('win-1', 'cherryin', {})
    h.deepLinkTransportMock.consumeCallback.mockReturnValue({
      code: 'c',
      codeVerifier: 'v',
      state: 'st',
      initiatorWindowId: 'win-1',
      context: {}
    })
    h.clientMock.exchangeCode.mockRejectedValue(new Error('boom'))

    await service.handleDeepLinkCallback(new URL('app://cb?state=st&code=c'))

    expect(h.deepLinkTransportMock.sendConsumedResult).toHaveBeenCalledWith('st', 'win-1', { error: 'boom' })
  })

  // User-denies path: the transport throws while consuming (error param in the
  // callback), which also deletes the pending flow. The initiator window id is
  // read BEFORE consume, so the initiator is still notified of the failure.
  it('notifies the initiator when the callback is a denied/error redirect', async () => {
    await service.startDeepLinkFlow('win-1', 'cherryin', {})
    h.deepLinkTransportMock.consumeCallback.mockImplementation(() => {
      throw new Error('User denied access')
    })

    await service.handleDeepLinkCallback(new URL('app://cb?state=st&error=access_denied'))

    expect(h.deepLinkTransportMock.getInitiatorWindowId).toHaveBeenCalledWith('st')
    expect(h.deepLinkTransportMock.sendConsumedResult).toHaveBeenCalledWith('st', 'win-1', {
      error: 'User denied access'
    })
  })

  // M1: the post-persist side effect (CherryIN's API-key fetch) runs AFTER the
  // token is stored, so a transient failure there keeps the minted token rather
  // than discarding it and forcing the user through the whole flow again.
  it('keeps the persisted token when the post-persist side effect fails', async () => {
    await service.startDeepLinkFlow('win-1', 'cherryin', {})
    h.deepLinkTransportMock.consumeCallback.mockReturnValue({
      code: 'c',
      codeVerifier: 'v',
      state: 'st',
      initiatorWindowId: 'win-1',
      context: {}
    })
    h.clientMock.exchangeCode.mockResolvedValue({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
    h.afterPersistMock.mockRejectedValue(new Error('key fetch 503'))

    await service.handleDeepLinkCallback(new URL('app://cb?state=st&code=c'))

    expect(h.providerStore.get('cherryin')?.authConfig).toMatchObject({ accessToken: 'at' })
    expect(h.deepLinkTransportMock.sendConsumedResult).toHaveBeenCalledWith('st', 'win-1', { error: 'key fetch 503' })
  })
})
