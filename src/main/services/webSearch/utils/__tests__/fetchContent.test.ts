import type * as JsdomModule from 'jsdom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
const lookupMock = vi.hoisted(() => vi.fn())
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

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock
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

function createTextResponse(body: string, contentType: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType
    }
  })
}

describe('fetchWebSearchContent', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    lookupMock.mockReset()
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    jsdomConstructorMock.mockReset()
  })

  it('normalizes empty readability output to an empty string', async () => {
    fetchMock.mockResolvedValue(createTextResponse('<html><body><div></div></body></html>', 'text/html'))

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
    fetchMock.mockResolvedValue(createTextResponse(html, 'text/html'))

    await fetchWebSearchContent('https://example.com/article')

    expect(jsdomConstructorMock).toHaveBeenCalledWith(html, { url: 'http://localhost/' })
  })

  it('throws when fetching content fails', async () => {
    fetchMock.mockResolvedValue(createTextResponse('server error', 'text/plain', 500))

    await expect(fetchWebSearchContent('https://example.com/article')).rejects.toThrow('HTTP error: 500')
  })

  it('rejects private/metadata addresses before fetching (SSRF guard)', async () => {
    await expect(fetchWebSearchContent('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/local or private/)
    // Blocked before any network call.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects hostnames that resolve to private addresses before fetching', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])

    await expect(fetchWebSearchContent('https://example.com/article')).rejects.toThrow(/DNS resolved/)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects hostnames when any resolved address is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: 'fd00::1', family: 6 }
    ])

    await expect(fetchWebSearchContent('https://example.com/article')).rejects.toThrow(/DNS resolved/)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disables automatic redirects for direct content fetches', async () => {
    const html = '<html><body><article><p>hello</p></article></body></html>'
    fetchMock.mockResolvedValue(createTextResponse(html, 'text/html'))

    await fetchWebSearchContent('https://example.com/article', { redirect: 'follow' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.objectContaining({ redirect: 'error' })
    )
  })
})
