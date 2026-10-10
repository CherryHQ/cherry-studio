import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetchMock, openExternalMock } = vi.hoisted(() => ({
  netFetchMock: vi.fn(),
  openExternalMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getLocale: () => 'en-US' },
  net: { fetch: netFetchMock },
  shell: { openExternal: openExternalMock }
}))

const { authorizeTokenDanceApiKey } = await import('../tokenDanceOAuth')

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function getCallbackUrl(rawAuthorizationUrl: string): URL {
  const authorizationUrl = new URL(rawAuthorizationUrl)
  return new URL(authorizationUrl.searchParams.get('callback_url')!)
}

describe('authorizeTokenDanceApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses a loopback callback and S256 PKCE before returning the exchanged API key', async () => {
    let authorizationUrl: URL | undefined
    let callbackResponse: Promise<Response> | undefined

    openExternalMock.mockImplementation(async (rawUrl: string) => {
      authorizationUrl = new URL(rawUrl)
      const callbackUrl = getCallbackUrl(rawUrl)
      callbackUrl.searchParams.set('code', 'authorization-code')
      callbackResponse = fetch(callbackUrl)
    })
    netFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ key: '  td-secret-key  ' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    await expect(authorizeTokenDanceApiKey()).resolves.toBe('td-secret-key')
    const browserResponse = await callbackResponse

    expect(browserResponse?.status).toBe(200)
    expect(browserResponse?.headers.get('connection')).toBe('close')
    expect(await browserResponse?.text()).toContain('Authentication Successful')
    expect(authorizationUrl?.origin).toBe('https://tokendance.space')
    expect(authorizationUrl?.pathname).toBe('/auth')
    expect(authorizationUrl?.searchParams.get('app_url')).toBe('app://cherryai.com.cn')
    expect(authorizationUrl?.searchParams.get('key_name')).toBe('Cherry Studio')
    expect(authorizationUrl?.searchParams.get('code_challenge_method')).toBe('S256')

    const callbackUrl = new URL(authorizationUrl!.searchParams.get('callback_url')!)
    expect(callbackUrl.hostname).toBe('127.0.0.1')
    expect(callbackUrl.port).not.toBe('')
    expect(callbackUrl.pathname).toBe('/oauth/tokendance/callback')
    expect(callbackUrl.searchParams.get('state')).toMatch(/^[a-f0-9]{32}$/)

    const [, request] = netFetchMock.mock.calls[0]
    const body = JSON.parse(String(request.body))
    expect(body).toMatchObject({
      code: 'authorization-code',
      code_challenge_method: 'S256'
    })
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorizationUrl?.searchParams.get('code_challenge')).toBe(
      base64UrlEncode(createHash('sha256').update(body.code_verifier).digest())
    )
    expect(netFetchMock).toHaveBeenCalledWith(
      'https://tokendance.space/portal/api/v1/auth/keys',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    )
  })

  it('rejects an authorization error without exchanging a code', async () => {
    let callbackResponse: Promise<Response> | undefined

    openExternalMock.mockImplementation(async (rawUrl: string) => {
      const callbackUrl = getCallbackUrl(rawUrl)
      callbackUrl.searchParams.set('error', 'access_denied')
      callbackResponse = fetch(callbackUrl)
    })

    await expect(authorizeTokenDanceApiKey()).rejects.toThrow('TokenDance authorization was not completed')
    expect((await callbackResponse!).status).toBe(400)
    expect(netFetchMock).not.toHaveBeenCalled()
  })

  it('keeps waiting after invalid callbacks and accepts the matching state with a code', async () => {
    let invalidStateResponse: Response | undefined
    let missingCodeResponse: Response | undefined
    let validResponse: Promise<Response> | undefined

    openExternalMock.mockImplementation(async (rawUrl: string) => {
      const callbackUrl = getCallbackUrl(rawUrl)

      const invalidStateUrl = new URL(callbackUrl)
      invalidStateUrl.searchParams.set('state', 'wrong-state')
      invalidStateUrl.searchParams.set('code', 'stolen-code')
      invalidStateResponse = await fetch(invalidStateUrl)

      const missingCodeUrl = new URL(callbackUrl)
      missingCodeResponse = await fetch(missingCodeUrl)

      callbackUrl.searchParams.set('code', 'authorization-code')
      validResponse = fetch(callbackUrl)
    })
    netFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ key: 'td-secret-key' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    await expect(authorizeTokenDanceApiKey()).resolves.toBe('td-secret-key')
    expect(invalidStateResponse?.status).toBe(400)
    expect(missingCodeResponse?.status).toBe(400)
    expect((await validResponse!).status).toBe(200)
  })

  it('rejects a failed API key exchange and reports failure to the callback page', async () => {
    let callbackResponse: Promise<Response> | undefined

    openExternalMock.mockImplementation(async (rawUrl: string) => {
      const callbackUrl = getCallbackUrl(rawUrl)
      callbackUrl.searchParams.set('code', 'authorization-code')
      callbackResponse = fetch(callbackUrl)
    })
    netFetchMock.mockResolvedValue(new Response(null, { status: 403 }))

    await expect(authorizeTokenDanceApiKey()).rejects.toThrow('TokenDance API key exchange failed with status 403')
    expect((await callbackResponse!).status).toBe(500)
  })

  it('rejects an empty API key returned by the exchange endpoint', async () => {
    let callbackResponse: Promise<Response> | undefined

    openExternalMock.mockImplementation(async (rawUrl: string) => {
      const callbackUrl = getCallbackUrl(rawUrl)
      callbackUrl.searchParams.set('code', 'authorization-code')
      callbackResponse = fetch(callbackUrl)
    })
    netFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ key: '   ' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    await expect(authorizeTokenDanceApiKey()).rejects.toThrow(
      'TokenDance API key exchange returned an invalid response'
    )
    expect((await callbackResponse!).status).toBe(500)
  })

  it('closes the callback server when opening the authorization URL fails', async () => {
    let callbackUrl: URL | undefined

    openExternalMock.mockImplementation(async (rawUrl: string) => {
      callbackUrl = getCallbackUrl(rawUrl)
      throw new Error('browser unavailable')
    })

    await expect(authorizeTokenDanceApiKey()).rejects.toThrow('browser unavailable')
    await expect(fetch(callbackUrl!, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
  })

  it('times out authorization and closes the callback server', async () => {
    let callbackUrl: URL | undefined
    let resolveOpened!: () => void
    const opened = new Promise<void>((resolve) => {
      resolveOpened = resolve
    })

    vi.useFakeTimers()
    try {
      openExternalMock.mockImplementation(async (rawUrl: string) => {
        callbackUrl = getCallbackUrl(rawUrl)
        resolveOpened()
      })

      const authorization = expect(authorizeTokenDanceApiKey()).rejects.toThrow('TokenDance authorization timed out')
      await opened
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      await authorization
    } finally {
      vi.useRealTimers()
    }

    await expect(fetch(callbackUrl!, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
  })
})
