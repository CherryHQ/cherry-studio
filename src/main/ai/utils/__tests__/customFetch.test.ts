import { afterEach, describe, expect, it, vi } from 'vitest'

import { customFetch } from '../customFetch'

describe('customFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('delegates to Node fetch instead of Electron net.fetch', async () => {
    const response = new Response('ok')
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    const init: RequestInit = { method: 'POST', body: '{}' }
    const result = await customFetch('https://api.test/v1/chat', init)

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/v1/chat', init)
    expect(result).toBe(response)
  })

  it('passes a URL input through unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response())
    vi.stubGlobal('fetch', fetchMock)
    const url = new URL('https://api.test/v1/models')

    await customFetch(url)

    expect(fetchMock).toHaveBeenCalledWith(url, undefined)
  })

  it('passes a Request input through unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response())
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://api.test/v1/ping')

    await customFetch(request)

    expect(fetchMock).toHaveBeenCalledWith(request, undefined)
  })
})
