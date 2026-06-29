import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const providerStore = new Map<string, { authConfig?: unknown; isEnabled?: boolean }>()
  const refreshMock = vi.fn()
  return {
    providerStore,
    refreshMock,
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
      getAuthConfig: vi.fn(async (id: string) => providerStore.get(id)?.authConfig ?? null),
      update: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        providerStore.set(id, { ...(providerStore.get(id) ?? {}), ...patch })
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
      createClient: () => h.clientMock
    }
  }
}))

import { OAuthHttpError } from '@main/utils/oauth/PkceOAuthClient'

import { OAuthRuntimeService } from '../OAuthRuntimeService'

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
    service = new OAuthRuntimeService()
  })

  it('returns a still-valid token without refreshing', async () => {
    seedOAuth('codex', { accessToken: 'tok', expiresAt: FUTURE(), accountId: 'acc' })
    expect(await service.getValidAccessToken('codex')).toEqual({ accessToken: 'tok', accountId: 'acc' })
    expect(h.refreshMock).not.toHaveBeenCalled()
  })

  // W1: a transient refresh failure must NOT log the user out.
  it('keeps the stored token when a refresh fails transiently (network/5xx)', async () => {
    seedOAuth('codex', { accessToken: 'old', refreshToken: 'r', expiresAt: PAST() })
    h.refreshMock.mockRejectedValue(new Error('network down'))

    expect(await service.getValidAccessToken('codex')).toBeNull()
    const stored = h.providerStore.get('codex')
    expect((stored?.authConfig as { type: string }).type).toBe('oauth')
    expect((stored?.authConfig as { refreshToken?: string }).refreshToken).toBe('r')
    expect(stored?.isEnabled).toBeUndefined()
  })

  // A 408 from the token endpoint is transient too — must keep the session.
  it('keeps the stored token when a refresh returns 408 (request timeout)', async () => {
    seedOAuth('codex', { accessToken: 'old', refreshToken: 'r', expiresAt: PAST() })
    h.refreshMock.mockRejectedValue(new OAuthHttpError('timeout', 408, ''))

    expect(await service.getValidAccessToken('codex')).toBeNull()
    expect((h.providerStore.get('codex')?.authConfig as { type: string }).type).toBe('oauth')
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
      service.authenticatedFetch('codex', () => ({ input: 'x', init: {} }), vi.fn(), 'please sign in')
    ).rejects.toThrow('please sign in')
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
    expect((stored?.authConfig as { accessToken?: string }).accessToken).toBe('at')
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
    await service.startDeepLinkFlow({ sender: {} } as unknown as Electron.IpcMainInvokeEvent, 'cherryin', {})
    h.deepLinkTransportMock.consumeCallback.mockReturnValue({
      code: 'c',
      codeVerifier: 'v',
      state: 'st',
      initiatorWindowId: 'win-1',
      context: {}
    })
    h.clientMock.exchangeCode.mockResolvedValue({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })

    await service.handleDeepLinkCallback(new URL('app://cb?state=st&code=c'))

    expect((h.providerStore.get('cherryin')?.authConfig as { accessToken?: string }).accessToken).toBe('at')
    expect(h.deepLinkTransportMock.sendConsumedResult).toHaveBeenCalledWith('st', 'win-1', { apiKeys: undefined })
  })

  it('handleDeepLinkCallback reports an exchange failure to the initiator', async () => {
    await service.startDeepLinkFlow({ sender: {} } as unknown as Electron.IpcMainInvokeEvent, 'cherryin', {})
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
})
