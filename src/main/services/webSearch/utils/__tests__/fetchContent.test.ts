import type * as JsdomModule from 'jsdom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchRemoteTextMock = vi.hoisted(() => vi.fn())
const jsdomConstructorMock = vi.hoisted(() => vi.fn())

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@main/utils/remoteFetch', () => ({
  fetchRemoteText: fetchRemoteTextMock
}))

vi.mock('jsdom', async () => {
  const actual = await vi.importActual<JsdomModule>('jsdom')

  return {
    ...actual,
    JSDOM: vi.fn().mockImplementation(function (
      ...args: ConstructorParameters<typeof actual.JSDOM>
    ): InstanceType<typeof actual.JSDOM> {
      jsdomConstructorMock(...args)
      return new actual.JSDOM(...args)
    })
  }
})

import { fetchWebSearchContent } from '../fetchContent'

describe('fetchWebSearchContent', () => {
  beforeEach(() => {
    fetchRemoteTextMock.mockReset()
    jsdomConstructorMock.mockReset()
  })

  it('normalizes empty readability output to an empty string', async () => {
    fetchRemoteTextMock.mockResolvedValue('<html><body><div></div></body></html>')

    const result = await fetchWebSearchContent('https://example.com/article')

    expect(result).toEqual({
      title: 'https://example.com/article',
      url: 'https://example.com/article',
      content: '',
      sourceInput: 'https://example.com/article'
    })
  })

  it('uses a safe synthetic URL for JSDOM instead of the remote document URL', async () => {
    const html = '<html><body><article><p>hello</p></article></body></html>'
    fetchRemoteTextMock.mockResolvedValue(html)

    await fetchWebSearchContent('https://example.com/article')

    expect(jsdomConstructorMock).toHaveBeenCalledWith(html, { url: 'http://localhost/' })
  })

  it('passes the default user-agent to the remote fetch helper', async () => {
    fetchRemoteTextMock.mockResolvedValue('<html><body><article><p>hello</p></article></body></html>')

    await fetchWebSearchContent('https://example.com/article')

    const options = fetchRemoteTextMock.mock.calls[0]?.[1] as { headers: Headers }
    expect(options.headers.get('User-Agent')).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
  })

  it('throws when fetching content fails', async () => {
    fetchRemoteTextMock.mockRejectedValue(new Error('HTTP error: 500'))

    await expect(fetchWebSearchContent('https://example.com/article')).rejects.toThrow('HTTP error: 500')
  })

  it('propagates remote fetch safety errors', async () => {
    fetchRemoteTextMock.mockRejectedValue(new Error('Unsafe remote url: local or private addresses are not allowed'))

    await expect(fetchWebSearchContent('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/local or private/)
  })
})
