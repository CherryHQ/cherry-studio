import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  net: {
    fetch: vi.fn()
  }
}))

import { net } from 'electron'

import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'

import { oauthProviderDefinitions } from '../providerDefinitions'
import { cherryInOAuthProvider } from '../providers/cherryin'

function discoveryResponse(authorizationEndpoint: string, tokenEndpoint: string): Response {
  return Response.json({ authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint })
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

describe('oauthProviderDefinitions', () => {
  it('extracts Codex account id from a base64url JWT payload', () => {
    const payload = base64UrlJson({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-123'
      }
    })
    const token = `${base64UrlJson({ alg: 'none' })}.${payload}.signature`

    expect(oauthProviderDefinitions[OPENAI_CODEX_PROVIDER_ID].extractAccountId?.(token)).toBe('account-123')
  })

  it('returns null for malformed Codex access tokens', () => {
    expect(oauthProviderDefinitions[OPENAI_CODEX_PROVIDER_ID].extractAccountId?.('not-a-jwt')).toBeNull()
  })
})

// `grokDiscoveryCache` is module-global. The reject case throws before caching,
// so it leaves the cache empty for the caching case that follows — keep that
// order (reject before success) so neither test sees a polluted cache.
describe('Grok OIDC discovery host-pinning', () => {
  beforeEach(() => {
    vi.mocked(net.fetch).mockReset()
  })

  it('rejects a discovery document whose token endpoint points off x.ai', async () => {
    vi.mocked(net.fetch).mockResolvedValue(
      discoveryResponse('https://auth.x.ai/oauth2/auth', 'https://evil.example/token')
    )
    await expect(oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient()).rejects.toMatchObject({
      failure: { reason: 'invalid_response' }
    })
  })

  it('forwards the sign-in cancellation signal to the discovery request', async () => {
    const controller = new AbortController()
    vi.mocked(net.fetch).mockResolvedValue(
      discoveryResponse('https://auth.x.ai/oauth2/auth', 'https://evil.example/token')
    )

    await expect(
      oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient({ signal: controller.signal })
    ).rejects.toMatchObject({ failure: { reason: 'invalid_response' } })
    expect(net.fetch).toHaveBeenCalledWith('https://auth.x.ai/.well-known/openid-configuration', {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    const combined = vi.mocked(net.fetch).mock.calls[0][1]?.signal
    controller.abort()
    expect(combined?.aborted).toBe(true)
  })

  it.each([400, 408, 503])('retains a real discovery HTTP status %s', async (status) => {
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response('TOKEN_MARKER', { status }))
    await expect(oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient()).rejects.toMatchObject({ status })
  })

  it('classifies discovery fetch rejection without treating parse errors as network', async () => {
    vi.mocked(net.fetch).mockRejectedValueOnce(new TypeError('TOKEN_MARKER'))
    await expect(oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient()).rejects.toMatchObject({
      failure: { reason: 'network' }
    })
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response('{TOKEN_MARKER'))
    await expect(oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient()).rejects.toMatchObject({
      failure: { reason: 'invalid_response' }
    })
    vi.mocked(net.fetch).mockResolvedValueOnce(Response.json({ token_endpoint: 123 }))
    await expect(oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient()).rejects.toMatchObject({
      failure: { reason: 'invalid_response' }
    })
  })

  it('distinguishes an expired discovery signal from a transport failure', async () => {
    const deadline = new AbortController()
    vi.mocked(net.fetch).mockImplementationOnce(async () => {
      deadline.abort()
      throw deadline.signal.reason
    })
    await expect(
      oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient({ signal: deadline.signal })
    ).rejects.toMatchObject({ failure: { reason: 'request_timeout' } })
  })

  it('caches discovery after the first successful fetch', async () => {
    vi.mocked(net.fetch).mockResolvedValue(
      discoveryResponse('https://auth.x.ai/oauth2/auth', 'https://auth.x.ai/oauth2/token')
    )
    await oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient()
    await oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient()
    expect(net.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('CherryIN HTTP callback contract', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['headers', 'body'])('times out a stalled API-key response at the %s stage', async (stage) => {
    const timeout = new AbortController()
    const timeoutError = new DOMException('API-key request timed out', 'TimeoutError')
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    vi.mocked(net.fetch).mockImplementationOnce(async (_url, options) => {
      if (stage === 'headers') {
        return new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
        })
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            options?.signal?.addEventListener('abort', () => controller.error(options.signal?.reason), { once: true })
          }
        })
      )
    })
    let result: unknown = 'pending'
    void cherryInOAuthProvider.afterPersistTokens({ access_token: 'private-token' }, {}).catch((error) => {
      result = error
    })
    timeout.abort(timeoutError)

    await vi.waitFor(() => expect(result).toBe(timeoutError), { timeout: 200 })
    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
  })

  it('uses the registered loopback URI for both authorization and token exchange', async () => {
    const client = cherryInOAuthProvider.createClient({ oauthServer: 'https://open.cherryin.dev' })
    const request = client.createAuthorizationRequest()
    const url = new URL(request.authUrl)
    expect(url.origin).toBe('https://open.cherryin.dev')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:29873/oauth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(request.state).not.toBe('')
    expect(cherryInOAuthProvider.transport).toMatchObject({
      hosts: ['127.0.0.1'],
      port: 29873,
      path: '/oauth/callback'
    })
    vi.mocked(net.fetch).mockImplementationOnce(async (_url, options) => {
      const body = new URLSearchParams(String(options?.body))
      expect(body.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'))
      expect(body.get('code_verifier')).toBe(request.codeVerifier)
      expect(body.get('code')).toBe('test-code')
      return new Response(JSON.stringify({ access_token: 'test-token' }))
    })
    await expect(client.exchangeCode('test-code', request.codeVerifier)).resolves.toMatchObject({
      access_token: 'test-token'
    })
  })

  it('rejects an untrusted authorization host before opening a browser', () => {
    expect(() => cherryInOAuthProvider.createClient({ oauthServer: 'https://evil.example' })).toThrow(/Unauthorized/)
  })
})
