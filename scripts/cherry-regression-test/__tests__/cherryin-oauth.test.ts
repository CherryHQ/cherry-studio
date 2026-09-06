import { describe, expect, it, vi } from 'vitest'

import { completeCherryInOauth } from '../cherryin-oauth'

const STATE = 'state-31415'
const AUTHORIZATION_URL = `https://open.cherryin.ai/oauth2/auth?state=${STATE}&client_id=cherry-studio`
const LOGIN_URL = 'https://open.cherryin.ai/register?login_challenge=login-27182'
const CONSENT_URL = 'https://open.cherryin.ai/oauth/consent?consent_challenge=consent-16180'
const LOGIN_CONTINUATION_URL = 'https://open.cherryin.ai/oauth2/auth?login_verifier=login-verifier-14142'
const CONSENT_CONTINUATION_URL = 'https://open.cherryin.ai/oauth2/auth?consent_verifier=consent-verifier-17320'

function jsonResponse(data: Record<string, unknown>): Response {
  return Response.json({ data, success: true })
}

function createOauthFetch(
  options: { authorizationRedirect?: string; callbackState?: string; loginData?: Record<string, unknown> } = {}
) {
  return vi.fn(async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input.toString())
    const method = init.method ?? 'GET'
    if (url.pathname === '/oauth2/auth') {
      if (url.searchParams.has('login_verifier')) {
        return new Response(null, { headers: { location: CONSENT_URL }, status: 302 })
      }
      if (url.searchParams.has('consent_verifier')) {
        return new Response(null, {
          headers: {
            location: `cherrystudio://oauth/callback?code=code-14142&state=${options.callbackState ?? STATE}`
          },
          status: 302
        })
      }
      return new Response(null, {
        headers: {
          location: options.authorizationRedirect ?? LOGIN_URL,
          'set-cookie': 'oauth_session=session-31415; Path=/; HttpOnly; Secure'
        },
        status: 302
      })
    }
    if (['/oauth/login', '/register'].includes(url.pathname)) return new Response('<main>Login</main>')
    if (url.pathname === '/api/oauth/login' && method === 'GET') return jsonResponse({ client_name: 'Cherry Studio' })
    if (url.pathname === '/api/oauth/login' && method === 'POST') {
      return jsonResponse(options.loginData ?? { redirect_to: LOGIN_CONTINUATION_URL })
    }
    if (url.pathname === '/oauth/consent') return new Response('<main>Consent</main>')
    if (url.pathname === '/api/oauth/consent' && method === 'GET') {
      return jsonResponse({ requested_scope: ['openid', 'tokens:read'] })
    }
    if (url.pathname === '/api/oauth/consent' && method === 'POST') {
      return jsonResponse({ redirect_to: CONSENT_CONTINUATION_URL })
    }
    throw new Error('Unexpected OAuth request')
  })
}

describe('CherryIN OAuth automation', () => {
  it('completes the application flow while preserving the server session cookie', async () => {
    const fetchImplementation = createOauthFetch()

    const callback = await completeCherryInOauth(
      AUTHORIZATION_URL,
      { account: 'automation@example.test', password: 'account-secret' },
      { fetchImplementation }
    )

    expect(callback).toBe(`cherrystudio://oauth/callback?code=code-14142&state=${STATE}`)
    const loginRequest = fetchImplementation.mock.calls.find(([input, init]) => {
      const url = new URL(input.toString())
      return url.pathname === '/api/oauth/login' && init?.method === 'POST'
    })
    expect(loginRequest).toBeDefined()
    expect(new Headers(loginRequest?.[1]?.headers).get('cookie')).toBe('oauth_session=session-31415')
    expect(JSON.parse(String(loginRequest?.[1]?.body))).toEqual({
      login_challenge: 'login-27182',
      password: 'account-secret',
      username: 'automation@example.test'
    })
  })

  it('rejects a login that requires an unavailable second factor', async () => {
    await expect(
      completeCherryInOauth(
        AUTHORIZATION_URL,
        { account: 'automation@example.test', password: 'account-secret' },
        { fetchImplementation: createOauthFetch({ loginData: { require_2fa: true } }) }
      )
    ).rejects.toThrow('CherryIN regression account requires 2FA')
  })

  it('rejects redirects outside CherryIN before forwarding credentials', async () => {
    const fetchImplementation = createOauthFetch({
      authorizationRedirect: 'https://untrusted.example.test/oauth/login?login_challenge=stolen'
    })

    await expect(
      completeCherryInOauth(
        AUTHORIZATION_URL,
        { account: 'automation@example.test', password: 'account-secret' },
        { fetchImplementation }
      )
    ).rejects.toThrow('CherryIN OAuth authorization redirect was rejected')
    expect(fetchImplementation).toHaveBeenCalledOnce()
  })

  it('rejects callbacks whose state differs from the application request', async () => {
    await expect(
      completeCherryInOauth(
        AUTHORIZATION_URL,
        { account: 'automation@example.test', password: 'account-secret' },
        { fetchImplementation: createOauthFetch({ callbackState: 'unexpected-state' }) }
      )
    ).rejects.toThrow('CherryIN OAuth callback state did not match the application request')
  })
})
