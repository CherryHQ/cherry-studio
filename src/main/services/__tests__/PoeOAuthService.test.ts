import http from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getLocale: vi.fn(() => 'en-US'),
    getPath: vi.fn((key: string) => {
      switch (key) {
        case 'userData':
          return '/mock/userData'
        case 'temp':
          return '/mock/temp'
        case 'logs':
          return '/mock/logs'
        default:
          return '/mock/unknown'
      }
    }),
    getVersion: vi.fn(() => '1.0.0')
  },
  shell: {
    openExternal: mocks.openExternal
  }
}))

vi.mock('../ConfigManager', () => ({
  configManager: {
    getLanguage: vi.fn(() => 'en-US')
  }
}))

import PoeOAuthService, {
  buildPoeAuthorizationUrl,
  generatePoeCodeChallenge,
  generatePoeCodeVerifier,
  mapPoeCallbackError,
  mapPoeTokenError
} from '../PoeOAuthService'

describe('PoeOAuthService', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('builds the authorization URL with required PKCE parameters', () => {
    const authorizationUrl = new URL(
      buildPoeAuthorizationUrl({
        clientId: 'client_123',
        redirectUri: 'http://127.0.0.1:43123/callback',
        codeChallenge: 'challenge_abc',
        state: 'state_xyz'
      })
    )

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe('https://poe.com/oauth/authorize')
    expect(authorizationUrl.searchParams.get('client_id')).toBe('client_123')
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:43123/callback')
    expect(authorizationUrl.searchParams.get('response_type')).toBe('code')
    expect(authorizationUrl.searchParams.get('scope')).toBe('apikey:create')
    expect(authorizationUrl.searchParams.get('code_challenge')).toBe('challenge_abc')
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('state')).toBe('state_xyz')
  })

  it('generates base64url PKCE values', () => {
    const verifier = generatePoeCodeVerifier()

    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(generatePoeCodeChallenge('verifier')).toBe('iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ')
  })

  it('parses the localhost callback and returns a normalized API key result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ api_key: 'poe-api-key', api_key_expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    mocks.openExternal.mockImplementation(async (url) => {
      const authorizationUrl = new URL(url)
      const redirectUri = authorizationUrl.searchParams.get('redirect_uri')
      const state = authorizationUrl.searchParams.get('state')

      expect(redirectUri).toBeTruthy()
      expect(state).toBeTruthy()

      const callbackResponse = await requestLoopbackCallback(`${redirectUri}?code=auth-code%2F123&state=${state}`)

      expect(callbackResponse.statusCode).toBe(200)
      expect(callbackResponse.body).toContain('Connected to Poe')
      expect(callbackResponse.body).toContain('You can return to Cherry Studio now.')

      return
    })

    const result = await PoeOAuthService.login()

    expect(result).toEqual({ apiKey: 'poe-api-key', expiresIn: 3600 })
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [tokenUrl, requestInit] = fetchMock.mock.calls[0]
    expect(tokenUrl).toBe('https://api.poe.com/token')
    expect(requestInit.method).toBe('POST')
    expect(requestInit.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    })

    const body = new URLSearchParams(String(requestInit.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_id')).toBe('client_e6a654e59ea9437f9a561ca61d4ae6ef')
    expect(body.get('code')).toBe('auth-code/123')
    expect(body.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('surfaces Poe callback errors with a user-friendly message', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    mocks.openExternal.mockImplementation(async (url) => {
      const authorizationUrl = new URL(url)
      const redirectUri = authorizationUrl.searchParams.get('redirect_uri')
      const state = authorizationUrl.searchParams.get('state')

      const callbackResponse = await requestLoopbackCallback(
        `${redirectUri}?error=access_denied&error_description=User%20denied%20request&state=${state}`
      )

      expect(callbackResponse.statusCode).toBe(400)
      expect(callbackResponse.body).toContain('Poe authorization was denied. Please approve access to continue.')

      return
    })

    await expect(PoeOAuthService.login()).rejects.toThrow(
      'Poe authorization was denied. Please approve access to continue. User denied request'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries the token exchange once when Poe returns server_error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'server_error', error_description: 'temporary issue' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ api_key: 'retry-success', api_key_expires_in: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    mocks.openExternal.mockImplementation(async (url) => {
      const authorizationUrl = new URL(url)
      const redirectUri = authorizationUrl.searchParams.get('redirect_uri')
      const state = authorizationUrl.searchParams.get('state')

      await requestLoopbackCallback(`${redirectUri}?code=retry-code&state=${state}`)
      return
    })

    await expect(PoeOAuthService.login()).resolves.toEqual({ apiKey: 'retry-success', expiresIn: null })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces non-200 token exchange responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'expired code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    mocks.openExternal.mockImplementation(async (url) => {
      const authorizationUrl = new URL(url)
      const redirectUri = authorizationUrl.searchParams.get('redirect_uri')
      const state = authorizationUrl.searchParams.get('state')

      await requestLoopbackCallback(`${redirectUri}?code=expired-code&state=${state}`)
      return
    })

    await expect(PoeOAuthService.login()).rejects.toThrow(
      'The Poe authorization expired or could not be verified. Please sign in again. expired code'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails when the token response does not include an api_key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ api_key_expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    mocks.openExternal.mockImplementation(async (url) => {
      const authorizationUrl = new URL(url)
      const redirectUri = authorizationUrl.searchParams.get('redirect_uri')
      const state = authorizationUrl.searchParams.get('state')

      await requestLoopbackCallback(`${redirectUri}?code=missing-key&state=${state}`)
      return
    })

    await expect(PoeOAuthService.login()).rejects.toThrow('Poe sign-in completed, but no API key was returned.')
  })

  it('times out waiting for the callback and closes the callback server', async () => {
    const fetchMock = vi.fn()
    let redirectUri = ''
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler) => {
      queueMicrotask(() => {
        if (typeof callback === 'function') {
          callback()
        }
      })

      return 1 as unknown as NodeJS.Timeout
    }) as unknown as typeof setTimeout)

    mocks.openExternal.mockImplementation(async (url) => {
      redirectUri = new URL(url).searchParams.get('redirect_uri') || ''
      return
    })

    const loginPromise = PoeOAuthService.login()

    await expect(loginPromise).rejects.toThrow(
      'Timed out waiting for the Poe authorization response. Please try signing in again.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(clearTimeoutSpy).toHaveBeenCalled()
    await expectLoopbackServerClosed(redirectUri)
  })

  it('closes the callback server after a successful login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ api_key: 'poe-api-key', api_key_expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    let redirectUri = ''

    vi.stubGlobal('fetch', fetchMock)

    mocks.openExternal.mockImplementation(async (url) => {
      const authorizationUrl = new URL(url)
      redirectUri = authorizationUrl.searchParams.get('redirect_uri') || ''
      const state = authorizationUrl.searchParams.get('state')

      await requestLoopbackCallback(`${redirectUri}?code=cleanup-success&state=${state}`)
      return
    })

    await expect(PoeOAuthService.login()).resolves.toEqual({ apiKey: 'poe-api-key', expiresIn: 3600 })
    await expectLoopbackServerClosed(redirectUri)
  })

  it('closes the callback server after a failed token exchange', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    let redirectUri = ''

    vi.stubGlobal('fetch', fetchMock)

    mocks.openExternal.mockImplementation(async (url) => {
      const authorizationUrl = new URL(url)
      redirectUri = authorizationUrl.searchParams.get('redirect_uri') || ''
      const state = authorizationUrl.searchParams.get('state')

      await requestLoopbackCallback(`${redirectUri}?code=cleanup-failure&state=${state}`)
      return
    })

    await expect(PoeOAuthService.login()).rejects.toThrow(
      'The Poe authorization expired or could not be verified. Please sign in again.'
    )
    await expectLoopbackServerClosed(redirectUri)
  })

  it('maps documented Poe error codes to readable messages', () => {
    expect(mapPoeCallbackError('invalid_scope')).toBe('Poe rejected the requested permissions.')
    expect(mapPoeTokenError('invalid_grant')).toBe(
      'The Poe authorization expired or could not be verified. Please sign in again.'
    )
  })
})

async function requestLoopbackCallback(url: string): Promise<{ statusCode: number | undefined; body: string }> {
  return await new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = ''

      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body })
      })
    })

    request.on('error', reject)
  })
}

async function expectLoopbackServerClosed(redirectUri: string): Promise<void> {
  await expect(
    new Promise<void>((resolve, reject) => {
      const request = http.get(redirectUri, () => {
        reject(new Error('Expected callback server to be closed.'))
      })

      request.on('error', () => {
        resolve()
      })
    })
  ).resolves.toBeUndefined()
}
