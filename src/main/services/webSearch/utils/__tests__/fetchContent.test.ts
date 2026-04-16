import type * as JsdomModule from 'jsdom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
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
    jsdomConstructorMock.mockReset()
  })

  it('normalizes empty readability output to an empty string', async () => {
    fetchMock.mockResolvedValue(createTextResponse('<html><body><div></div></body></html>', 'text/html'))

    const result = await fetchWebSearchContent('https://example.com/article', false)

    expect(result).toEqual({
      title: 'https://example.com/article',
      url: 'https://example.com/article',
      content: ''
    })
  })

  it('uses a safe synthetic URL for JSDOM instead of the remote document URL', async () => {
    const html = '<html><body><article><p>hello</p></article></body></html>'
    fetchMock.mockResolvedValue(createTextResponse(html, 'text/html'))

    await fetchWebSearchContent('https://example.com/article', false)

    expect(jsdomConstructorMock).toHaveBeenCalledWith(html, { url: 'http://localhost/' })
  })

  it('throws when fetching content fails', async () => {
    fetchMock.mockResolvedValue(createTextResponse('server error', 'text/plain', 500))

    await expect(fetchWebSearchContent('https://example.com/article', false)).rejects.toThrow('HTTP error: 500')
  })
})
