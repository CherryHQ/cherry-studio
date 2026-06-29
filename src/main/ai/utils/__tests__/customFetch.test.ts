import { net, session } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { customFetch, installProviderUserAgentInterceptor } from '../customFetch'

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

    expect(net.fetch).toHaveBeenCalledWith('https://api.test/v1/chat', init)
    expect(result).toBe(response)
  })

  it('converts a URL input to a string, which net.fetch requires', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response())

    await customFetch(new URL('https://api.test/v1/models'))

    expect(net.fetch).toHaveBeenCalledWith('https://api.test/v1/models', undefined)
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

  it('leaves requests without a User-Agent untouched', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response())

    const init: RequestInit = { method: 'POST', headers: { Authorization: 'Bearer k' } }
    await customFetch('https://api.test/v1/chat', init)

    // Same init object forwarded — no sentinel header added.
    expect(net.fetch).toHaveBeenCalledWith('https://api.test/v1/chat', init)
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
