import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { customFetch } from '../customFetch'

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
})
