import { describe, expect, it, vi } from 'vitest'

import { createFetchPreservingHeadersOnRedirect } from '../preserveHeadersOnRedirectFetch'

describe('createFetchPreservingHeadersOnRedirect', () => {
  it('re-sends Authorization and custom headers after a 307 redirect', async () => {
    const inner = vi.fn()
    inner
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: 'https://api.example.com/v1/chat/completions' }
        })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetchWrapped = createFetchPreservingHeadersOnRedirect(inner as unknown as typeof fetch)

    const res = await fetchWrapped('http://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'X-Custom': '1',
        'Content-Type': 'application/json'
      },
      body: '{"x":1}'
    })

    expect(res.status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(2)

    const first = inner.mock.calls[0][1] as RequestInit
    const second = inner.mock.calls[1][1] as RequestInit
    expect(first.redirect).toBe('manual')
    expect(second.redirect).toBe('manual')

    expect(second.headers).toBeDefined()
    const h2 = new Headers(second.headers as HeadersInit)
    expect(h2.get('Authorization')).toBe('Bearer secret')
    expect(h2.get('X-Custom')).toBe('1')
    expect(inner.mock.calls[1][0]).toBe('https://api.example.com/v1/chat/completions')
    expect(second.body).toBe('{"x":1}')
    expect(second.method).toBe('POST')
  })

  it('uses GET without body after 303', async () => {
    const inner = vi.fn()
    inner
      .mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: { Location: 'https://api.example.com/done' }
        })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const fetchWrapped = createFetchPreservingHeadersOnRedirect(inner as unknown as typeof fetch)

    await fetchWrapped('http://api.example.com/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })

    const second = inner.mock.calls[1][1] as RequestInit
    expect(second.method).toBe('GET')
    expect(second.body).toBeUndefined()
    const h2 = new Headers(second.headers as HeadersInit)
    expect(h2.has('content-type')).toBe(false)
  })
})
