import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'

import type * as JsdomModule from 'jsdom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
const httpRequestMock = vi.hoisted(() => vi.fn())
const httpsRequestMock = vi.hoisted(() => vi.fn())
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

vi.mock('node:http', () => ({
  request: httpRequestMock
}))

vi.mock('node:https', () => ({
  request: httpsRequestMock
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

function mockHttpsResponse(body: string, contentType: string, statusCode = 200) {
  httpsRequestMock.mockImplementation((_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const response = Object.assign(new EventEmitter(), {
      statusCode,
      headers: {
        'content-type': contentType
      }
    }) as IncomingMessage
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn(),
      setTimeout: vi.fn()
    })

    queueMicrotask(() => {
      callback(response)
      response.emit('data', Buffer.from(body))
      response.emit('end')
    })

    return request
  })
}

describe('fetchWebSearchContent', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    httpRequestMock.mockReset()
    httpsRequestMock.mockReset()
    lookupMock.mockReset()
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    jsdomConstructorMock.mockReset()
  })

  it('normalizes empty readability output to an empty string', async () => {
    mockHttpsResponse('<html><body><div></div></body></html>', 'text/html')

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
    mockHttpsResponse(html, 'text/html')

    await fetchWebSearchContent('https://example.com/article')

    expect(jsdomConstructorMock).toHaveBeenCalledWith(html, { url: 'http://localhost/' })
  })

  it('throws when fetching content fails', async () => {
    mockHttpsResponse('server error', 'text/plain', 500)

    await expect(fetchWebSearchContent('https://example.com/article')).rejects.toThrow('HTTP error: 500')
  })

  it('rejects private/metadata addresses before fetching (SSRF guard)', async () => {
    await expect(fetchWebSearchContent('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/local or private/)
    // Blocked before any network call.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('rejects hostnames that resolve to private addresses before fetching', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])

    await expect(fetchWebSearchContent('https://example.com/article')).rejects.toThrow(/DNS resolved/)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('rejects hostnames when any resolved address is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: 'fd00::1', family: 6 }
    ])

    await expect(fetchWebSearchContent('https://example.com/article')).rejects.toThrow(/DNS resolved/)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('fetches through a prevalidated DNS address without re-resolving at connection time', async () => {
    const html = '<html><body><article><h1>Title</h1><p>hello</p></article></body></html>'
    mockHttpsResponse(html, 'text/html')

    await fetchWebSearchContent('https://example.com/article')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(httpRequestMock).not.toHaveBeenCalled()
    expect(httpsRequestMock).toHaveBeenCalledOnce()

    const requestOptions = httpsRequestMock.mock.calls[0]?.[0] as RequestOptions
    expect(requestOptions.hostname).toBe('example.com')
    expect(requestOptions.servername).toBe('example.com')

    const callback = vi.fn()
    requestOptions.lookup?.('example.com', {}, callback)

    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4)

    const allCallback = vi.fn()
    requestOptions.lookup?.('example.com', { all: true }, allCallback)

    expect(allCallback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
    expect(lookupMock).toHaveBeenCalledTimes(1)
  })

  it('does not use fetch redirect-follow semantics for direct content fetches', async () => {
    const html = '<html><body><article><p>hello</p></article></body></html>'
    mockHttpsResponse(html, 'text/html')

    await fetchWebSearchContent('https://example.com/article', { redirect: 'follow' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(httpsRequestMock).toHaveBeenCalledOnce()
  })

  it('rejects redirects instead of parsing them as content', async () => {
    mockHttpsResponse('', 'text/html', 302)

    await expect(fetchWebSearchContent('https://example.com/redirect')).rejects.toThrow('HTTP error: 302')
  })
})
