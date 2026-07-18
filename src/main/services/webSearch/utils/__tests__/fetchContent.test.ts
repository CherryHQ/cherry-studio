import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchRemoteTextMock = vi.hoisted(() => vi.fn())
const extractReadableMarkdownMock = vi.hoisted(() => vi.fn())

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

vi.mock('@main/services/readableContent', () => ({
  readableContentService: { extractReadableMarkdown: extractReadableMarkdownMock }
}))

import { fetchWebSearchContent } from '../fetchContent'

describe('fetchWebSearchContent', () => {
  beforeEach(() => {
    fetchRemoteTextMock.mockReset()
    extractReadableMarkdownMock.mockReset()
    extractReadableMarkdownMock.mockResolvedValue({ title: '', content: '' })
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

  it('parses fetched HTML in the shared worker and passes through the abort signal', async () => {
    const html = '<html><body><article><p>hello</p></article></body></html>'
    const controller = new AbortController()
    fetchRemoteTextMock.mockResolvedValue(html)
    extractReadableMarkdownMock.mockResolvedValue({ title: 'Worker title', content: 'hello' })

    const result = await fetchWebSearchContent('https://example.com/article', { signal: controller.signal })

    expect(extractReadableMarkdownMock).toHaveBeenCalledWith(html, { signal: controller.signal })
    expect(result.title).toBe('Worker title')
    expect(result.content).toBe('hello')
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

  it('propagates caller aborts from the shared worker', async () => {
    const abortError = Object.assign(new Error('request aborted'), { name: 'AbortError' })
    fetchRemoteTextMock.mockResolvedValue('<html><body><article><p>hello</p></article></body></html>')
    extractReadableMarkdownMock.mockRejectedValue(abortError)

    await expect(fetchWebSearchContent('https://example.com/article')).rejects.toBe(abortError)
  })
})
