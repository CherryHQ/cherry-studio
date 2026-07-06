import { beforeEach, describe, expect, it, vi } from 'vitest'

const netMocks = vi.hoisted(() => ({
  fetch: vi.fn()
}))

vi.mock('electron', async (importOriginal) => {
  const actual = (await importOriginal()) as { net: Electron.Net }
  return {
    ...actual,
    net: { ...actual.net, fetch: netMocks.fetch }
  }
})

import { net } from 'electron'

import { OAuthHttpError, PkceOAuthClient } from '../PkceOAuthClient'

const CONFIG = {
  clientId: 'client-1',
  authorizeUrl: 'https://auth.example.com/authorize',
  tokenUrl: 'https://auth.example.com/token',
  redirectUri: 'https://app.example.com/callback',
  scope: 'openid profile'
}

const okJson = (body: unknown): Response =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as Response

describe('PkceOAuthClient.createAuthorizationRequest', () => {
  it('emits a PKCE-shaped authorize URL with S256 challenge, state, and verifier', () => {
    const client = new PkceOAuthClient({ ...CONFIG, extraAuthParams: { prompt: 'login' } })
    const { authUrl, state, codeVerifier } = client.createAuthorizationRequest()

    const url = new URL(authUrl)
    expect(url.origin + url.pathname).toBe('https://auth.example.com/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/callback')
    expect(url.searchParams.get('scope')).toBe('openid profile')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('state')).toBe(state)
    expect(url.searchParams.get('prompt')).toBe('login')

    // Verifier is base64url (no +/= padding) and within RFC 7636's 43-128 range.
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-_]{43,128}$/)
  })

  it('generates a unique state and verifier per call', () => {
    const client = new PkceOAuthClient(CONFIG)
    const a = client.createAuthorizationRequest()
    const b = client.createAuthorizationRequest()
    expect(a.state).not.toBe(b.state)
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
  })
})

describe('PkceOAuthClient.exchangeCode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('posts the authorization_code grant and parses the token response', async () => {
    vi.mocked(net.fetch).mockResolvedValue(okJson({ access_token: 'access', refresh_token: 'refresh' }))

    const client = new PkceOAuthClient(CONFIG)
    const tokens = await client.exchangeCode('the-code', 'the-verifier')

    expect(tokens).toEqual({ access_token: 'access', refresh_token: 'refresh' })

    const [calledUrl, init] = vi.mocked(net.fetch).mock.calls[0]
    expect(String(calledUrl)).toBe('https://auth.example.com/token')
    const body = new URLSearchParams(String(init?.body))
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'client-1',
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: 'https://app.example.com/callback'
    })
  })

  it('throws OAuthHttpError carrying status and body on a non-2xx response', async () => {
    vi.mocked(net.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'invalid_grant'
    } as Response)

    const client = new PkceOAuthClient(CONFIG)
    await expect(client.exchangeCode('bad', 'verifier')).rejects.toMatchObject({
      name: 'OAuthHttpError',
      message: 'Failed to exchange code for token: 400',
      status: 400,
      body: 'invalid_grant'
    })
    expect(OAuthHttpError).toBeDefined()
  })
})

describe('PkceOAuthClient.refresh', () => {
  beforeEach(() => vi.clearAllMocks())

  it('posts the refresh_token grant and parses the token response', async () => {
    vi.mocked(net.fetch).mockResolvedValue(okJson({ access_token: 'fresh', expires_in: 3600 }))

    const client = new PkceOAuthClient(CONFIG)
    const tokens = await client.refresh('old-refresh')

    expect(tokens).toEqual({ access_token: 'fresh', expires_in: 3600 })

    const [, init] = vi.mocked(net.fetch).mock.calls[0]
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      grant_type: 'refresh_token',
      client_id: 'client-1',
      refresh_token: 'old-refresh'
    })
  })

  it('throws OAuthHttpError on a non-2xx refresh response', async () => {
    vi.mocked(net.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'expired'
    } as Response)

    const client = new PkceOAuthClient(CONFIG)
    await expect(client.refresh('dead')).rejects.toMatchObject({
      message: 'Failed to refresh access token: 401',
      status: 401
    })
  })
})
