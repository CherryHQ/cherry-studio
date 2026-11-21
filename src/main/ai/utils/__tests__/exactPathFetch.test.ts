import { describe, expect, it, vi } from 'vitest'

import { createExactPathFetch } from '../exactPathFetch'

describe('createExactPathFetch (#18972)', () => {
  it('rewrites a string request URL to the exact URL', async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response('{}'))
    const fetchFn = createExactPathFetch('https://gateway.example.com/router/answer', baseFetch)

    await fetchFn('https://gateway.example.com/chat/completions', { method: 'POST' })

    expect(baseFetch).toHaveBeenCalledWith('https://gateway.example.com/router/answer', { method: 'POST' })
  })

  it('rewrites a URL request to the exact URL', async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response('{}'))
    const fetchFn = createExactPathFetch('https://gateway.example.com/router/answer', baseFetch)

    await fetchFn(new URL('https://gateway.example.com/responses'), undefined)

    expect(baseFetch).toHaveBeenCalledWith('https://gateway.example.com/router/answer', undefined)
  })

  it('preserves method, headers and body of a Request input', async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response('{}'))
    const fetchFn = createExactPathFetch('https://gateway.example.com/router/answer', baseFetch)
    const original = new Request('https://gateway.example.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-test' },
      body: JSON.stringify({ model: 'gpt-4' })
    })

    await fetchFn(original)

    const forwarded = baseFetch.mock.calls[0][0] as Request
    expect(forwarded.url).toBe('https://gateway.example.com/router/answer')
    expect(forwarded.method).toBe('POST')
    expect(forwarded.headers.get('authorization')).toBe('Bearer sk-test')
    expect(await forwarded.text()).toBe(JSON.stringify({ model: 'gpt-4' }))
  })
})

describe('createExactPathFetch diagnostics (AC4)', () => {
  it('reports the effective path on failure with sensitive query values redacted', async () => {
    const apiError = Object.assign(new Error('Not Found'), {
      url: 'https://gateway.example.com/chat/completions'
    })
    const baseFetch = vi.fn().mockRejectedValue(apiError)
    const fetchFn = createExactPathFetch('https://gateway.example.com/router/answer?api_key=secret123', baseFetch)

    const failure = await fetchFn('https://gateway.example.com/chat/completions').catch((e: unknown) => e)

    expect(failure).toBe(apiError)
    expect((failure as { url?: string }).url).toContain('/router/answer')
    expect((failure as { url?: string }).url).not.toContain('secret123')
  })

  it('leaves non-extensible errors untouched', async () => {
    const frozen = Object.freeze(new Error('network'))
    const baseFetch = vi.fn().mockRejectedValue(frozen)
    const fetchFn = createExactPathFetch('https://gateway.example.com/router/answer', baseFetch)

    await expect(fetchFn('https://gateway.example.com/x')).rejects.toBe(frozen)
  })
})
