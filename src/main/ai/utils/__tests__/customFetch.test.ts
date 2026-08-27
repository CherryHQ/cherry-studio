import { net, session } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  customFetch,
  HTTP_TRACE_FINAL_BODY_SLOT,
  type HttpTraceFinalBodySlot,
  installProviderUserAgentInterceptor
} from '../customFetch'

const SENTINEL_HEADER = 'x-cherry-studio-user-agent'

describe('customFetch', () => {
  beforeEach(() => {
    vi.mocked(net.fetch).mockReset()
  })

  it('delegates to net.fetch so the request uses the proxy-aware network stack', async () => {
    const response = new Response('ok')
    vi.mocked(net.fetch).mockResolvedValue(response)

    const init: RequestInit = { method: 'POST', body: '{}' }
    const result = await customFetch('https://api.test/v1/chat', init)

    expect(net.fetch).toHaveBeenCalledWith('https://api.test/v1/chat', { ...init, redirect: 'manual' })
    expect(result).toBe(response)
  })

  it('converts a URL input to a string, which net.fetch requires', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response())

    await customFetch(new URL('https://api.test/v1/models'))

    expect(net.fetch).toHaveBeenCalledWith('https://api.test/v1/models', { redirect: 'manual' })
  })

  it('passes a Request input through unchanged', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response())
    const request = new Request('https://api.test/v1/ping')

    await customFetch(request)

    expect(net.fetch).toHaveBeenCalledWith(request, undefined)
  })

  it('smuggles a custom User-Agent into the sentinel header so Chromium cannot drop it', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response())

    await customFetch('https://api.test/v1/chat', {
      method: 'POST',
      headers: { 'User-Agent': 'MyAgent/1.0', Authorization: 'Bearer k' }
    })

    const [, init] = vi.mocked(net.fetch).mock.calls[0]
    const headers = new Headers(init?.headers)
    // Original UA preserved on the sentinel; Authorization untouched.
    expect(headers.get(SENTINEL_HEADER)).toBe('MyAgent/1.0')
    expect(headers.get('Authorization')).toBe('Bearer k')
  })

  it('resolves the User-Agent override with case-insensitive last-writer-wins', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response())

    // Mirrors Copilot's `{ ...COPILOT_DEFAULT_HEADERS, ...extraHeaders }`: a default
    // `User-Agent` plus a lowercase `user-agent` override from extraHeaders. A bare
    // `new Headers(...).get('user-agent')` would comma-join the two; the override wins.
    await customFetch('https://api.test/v1/chat', {
      headers: { 'User-Agent': 'GitHubCopilotChat/0.26.7', 'user-agent': 'MyAgent/1.0' }
    })

    const [, init] = vi.mocked(net.fetch).mock.calls[0]
    expect(new Headers(init?.headers).get(SENTINEL_HEADER)).toBe('MyAgent/1.0')
  })

  it('records the final on-wire body into the HTTP-trace slot when present', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response())
    const slot: HttpTraceFinalBodySlot = {}
    const init: RequestInit & { [HTTP_TRACE_FINAL_BODY_SLOT]?: HttpTraceFinalBodySlot } = {
      method: 'POST',
      body: JSON.stringify({ tools: [{ type: 'web_extractor' }] }),
      [HTTP_TRACE_FINAL_BODY_SLOT]: slot
    }

    await customFetch('https://api.test/v1/responses', init)

    // The trace slot receives the exact body that goes onto the wire.
    expect(slot.body).toBe(JSON.stringify({ tools: [{ type: 'web_extractor' }] }))
  })

  it('does not add a User-Agent sentinel when none was provided', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response())

    const init: RequestInit = { method: 'POST', headers: { Authorization: 'Bearer k' } }
    await customFetch('https://api.test/v1/chat', init)

    const [, forwardedInit] = vi.mocked(net.fetch).mock.calls[0]
    expect(new Headers(forwardedInit?.headers).has(SENTINEL_HEADER)).toBe(false)
  })

  it('preserves authentication across a same-host HTTP-to-HTTPS redirect', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: 'https://api.test:443/v1/chat' }
        })
      )
      .mockResolvedValueOnce(new Response('ok'))

    const response = await customFetch('http://api.test:80/v1/chat', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
        'X-Custom': 'custom'
      },
      body: '{"message":"hello"}'
    })

    expect(await response.text()).toBe('ok')
    expect(net.fetch).toHaveBeenCalledTimes(2)
    const [redirectUrl, redirectInit] = vi.mocked(net.fetch).mock.calls[1]
    const redirectHeaders = new Headers(redirectInit?.headers)
    expect(redirectUrl).toBe('https://api.test/v1/chat')
    expect(redirectInit).toMatchObject({ method: 'POST', redirect: 'manual' })
    expect(redirectInit?.body).toBe('{"message":"hello"}')
    expect(redirectHeaders.get('Authorization')).toBe('Bearer secret')
    expect(redirectHeaders.get('X-Custom')).toBe('custom')
  })

  it('strips authentication when a redirect changes host', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: 'https://other.test/v1/chat' }
        })
      )
      .mockResolvedValueOnce(new Response('ok'))

    await customFetch('https://api.test/v1/chat', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'X-Api-Key': 'secret-key',
        'X-Custom': 'custom'
      },
      body: '{}'
    })

    const [, redirectInit] = vi.mocked(net.fetch).mock.calls[1]
    const redirectHeaders = new Headers(redirectInit?.headers)
    expect(redirectHeaders.get('Authorization')).toBeNull()
    expect(redirectHeaders.get('X-Api-Key')).toBeNull()
    expect(redirectHeaders.get('X-Custom')).toBe('custom')
  })

  it.each(['file:///etc/passwd', 'cherry-media://files/private'])(
    'rejects redirects to non-HTTP(S) protocol %s',
    async (location) => {
      vi.mocked(net.fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: location }
        })
      )

      await expect(customFetch('https://api.test/v1/chat')).rejects.toThrow('unsupported redirect protocol')
      expect(net.fetch).toHaveBeenCalledTimes(1)
    }
  )

  it('allows 20 redirects before fetching the successful destination', async () => {
    let requestCount = 0
    vi.mocked(net.fetch).mockImplementation(async () => {
      requestCount++
      return requestCount <= 20
        ? new Response(null, { status: 302, headers: { Location: `/hop-${requestCount}` } })
        : new Response('ok')
    })

    const response = await customFetch('https://api.test/start')

    expect(await response.text()).toBe('ok')
    expect(net.fetch).toHaveBeenCalledTimes(21)
  })

  it('rejects when the successful destination would require a 21st redirect', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response(null, { status: 302, headers: { Location: '/next' } }))

    await expect(customFetch('https://api.test/start')).rejects.toThrow('too many redirects')
    expect(net.fetch).toHaveBeenCalledTimes(21)
  })

  it.each([
    { method: 'POST', status: 302 },
    { method: 'PUT', status: 303 }
  ])('switches $method to GET without content headers for $status', async ({ method, status }) => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(
        new Response(null, {
          status,
          headers: { Location: '/result' }
        })
      )
      .mockResolvedValueOnce(new Response('ok'))

    const slot: HttpTraceFinalBodySlot = {}
    const init: RequestInit & { [HTTP_TRACE_FINAL_BODY_SLOT]?: HttpTraceFinalBodySlot } = {
      method,
      headers: {
        Authorization: 'Bearer secret',
        'Content-Encoding': 'gzip',
        'Content-Type': 'application/json'
      },
      body: '{}',
      [HTTP_TRACE_FINAL_BODY_SLOT]: slot
    }
    await customFetch('https://api.test/v1/chat', init)

    const [redirectUrl, redirectInit] = vi.mocked(net.fetch).mock.calls[1]
    const redirectHeaders = new Headers(redirectInit?.headers)
    expect(redirectUrl).toBe('https://api.test/result')
    expect(redirectInit?.method).toBe('GET')
    expect(redirectInit?.body).toBeUndefined()
    expect(redirectHeaders.get('Authorization')).toBe('Bearer secret')
    expect([...redirectHeaders.keys()].some((key) => key.startsWith('content-'))).toBe(false)
    expect(slot.body).toBeNull()
  })
})

describe('installProviderUserAgentInterceptor', () => {
  beforeEach(() => {
    vi.mocked(session.defaultSession.webRequest.onBeforeSendHeaders).mockReset()
  })

  /** Register the interceptor and return the handler Electron would invoke per request. */
  function captureHandler() {
    installProviderUserAgentInterceptor()
    return vi.mocked(session.defaultSession.webRequest.onBeforeSendHeaders).mock.calls[0][0] as (
      details: { requestHeaders: Record<string, string> },
      callback: (response: { requestHeaders?: Record<string, string> }) => void
    ) => void
  }

  it('restores the smuggled User-Agent and drops the sentinel + Chromium default UA', () => {
    const handler = captureHandler()
    const callback = vi.fn()

    handler(
      {
        requestHeaders: {
          'User-Agent': 'Chrome/Electron-default',
          'X-Cherry-Studio-User-Agent': 'MyAgent/1.0',
          Authorization: 'Bearer k'
        }
      },
      callback
    )

    expect(callback).toHaveBeenCalledWith({
      requestHeaders: { Authorization: 'Bearer k', 'User-Agent': 'MyAgent/1.0' }
    })
  })

  it('passes requests without the sentinel through unchanged', () => {
    const handler = captureHandler()
    const callback = vi.fn()
    const requestHeaders = { 'User-Agent': 'Chrome/Electron-default', Authorization: 'Bearer k' }

    handler({ requestHeaders }, callback)

    expect(callback).toHaveBeenCalledWith({ requestHeaders })
  })

  it('returns a disposer that clears the interceptor', () => {
    const dispose = installProviderUserAgentInterceptor()
    dispose()

    expect(session.defaultSession.webRequest.onBeforeSendHeaders).toHaveBeenLastCalledWith(null)
  })
})
