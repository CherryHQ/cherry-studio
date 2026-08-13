import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
const fetchRemoteTextMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('@main/utils/remoteFetch', () => ({
  fetchRemoteText: fetchRemoteTextMock
}))

import { Fetcher } from '../fetch'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

describe('Fetcher', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchRemoteTextMock.mockReset()
  })

  it('fetches HTML through the strict remote target helper', async () => {
    fetchRemoteTextMock.mockResolvedValue('<html><body><h1>Hello</h1></body></html>')

    const result = await Fetcher.html({
      url: 'https://example.com/page',
      headers: {
        'X-Test': 'yes'
      }
    })

    expect(result).toEqual({
      content: [{ type: 'text', text: '<html><body><h1>Hello</h1></body></html>' }],
      isError: false
    })
    expect(fetchRemoteTextMock).toHaveBeenCalledOnce()
    expect(fetchRemoteTextMock).toHaveBeenCalledWith('https://example.com/page', {
      headers: expect.any(Headers)
    })

    const options = fetchRemoteTextMock.mock.calls[0]?.[1] as { headers: Headers }
    expect(options.headers.get('User-Agent')).toBe(DEFAULT_USER_AGENT)
    expect(options.headers.get('X-Test')).toBe('yes')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('parses JSON from strict remote target text', async () => {
    fetchRemoteTextMock.mockResolvedValue('{"ok":true}')

    await expect(Fetcher.json({ url: 'https://example.com/data.json' })).resolves.toEqual({
      content: [{ type: 'text', text: '{"ok":true}' }],
      isError: false
    })
  })
})
