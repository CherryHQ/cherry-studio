import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const httpRequestMock = vi.hoisted(() => vi.fn())
const httpsRequestMock = vi.hoisted(() => vi.fn())
const lookupMock = vi.hoisted(() => vi.fn())

vi.mock('node:http', () => ({
  request: httpRequestMock
}))

vi.mock('node:https', () => ({
  request: httpsRequestMock
}))

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock
}))

import { fetchRemoteText } from '../remoteFetch'

type MockResponseOptions = {
  readonly body?: Buffer | string
  readonly headers?: IncomingMessage['headers']
  readonly statusCode?: number
}

function mockHttpsResponse({ body = 'ok', headers = {}, statusCode = 200 }: MockResponseOptions = {}) {
  const response = Object.assign(new EventEmitter(), {
    statusCode,
    headers,
    resume: vi.fn(),
    destroy: vi.fn()
  }) as IncomingMessage & { resume: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
  const request = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    destroy: vi.fn()
  })

  httpsRequestMock.mockImplementation((_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    queueMicrotask(() => {
      callback(response)
      response.emit('data', typeof body === 'string' ? Buffer.from(body) : body)
      response.emit('end')
    })

    return request
  })

  return { request, response }
}

describe('fetchRemoteText', () => {
  beforeEach(() => {
    httpRequestMock.mockReset()
    httpsRequestMock.mockReset()
    lookupMock.mockReset()
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  })

  it('fetches through a prevalidated DNS address without re-resolving at connection time', async () => {
    mockHttpsResponse({ body: 'hello' })

    await expect(fetchRemoteText('https://example.com/article')).resolves.toBe('hello')

    expect(httpRequestMock).not.toHaveBeenCalled()
    expect(httpsRequestMock).toHaveBeenCalledOnce()

    const requestOptions = httpsRequestMock.mock.calls[0]?.[0] as RequestOptions
    expect(requestOptions.hostname).toBe('example.com')
    expect(requestOptions.servername).toBe('example.com')
    expect(requestOptions.headers).toMatchObject({ host: 'example.com' })

    const callback = vi.fn()
    requestOptions.lookup?.('example.com', {}, callback)

    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4)

    const allCallback = vi.fn()
    requestOptions.lookup?.('example.com', { all: true }, allCallback)

    expect(allCallback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
    expect(lookupMock).toHaveBeenCalledTimes(1)
  })

  it('overrides caller-provided host headers with the validated URL host', async () => {
    mockHttpsResponse({ body: 'hello' })

    await expect(
      fetchRemoteText('https://example.com/article', {
        headers: {
          Host: 'internal.example',
          'User-Agent': 'Custom Agent'
        }
      })
    ).resolves.toBe('hello')

    const requestOptions = httpsRequestMock.mock.calls[0]?.[0] as RequestOptions
    expect(requestOptions.headers).toMatchObject({
      host: 'example.com',
      'user-agent': 'Custom Agent'
    })
  })

  it('rejects hostnames that resolve to private addresses before opening a request', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])

    await expect(fetchRemoteText('https://example.com/article')).rejects.toThrow(/DNS resolved/)

    expect(httpRequestMock).not.toHaveBeenCalled()
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('rejects promptly when the caller aborts while DNS resolution is pending', async () => {
    lookupMock.mockReturnValue(new Promise(() => undefined))
    const controller = new AbortController()

    const result = Promise.race([
      fetchRemoteText('https://example.com/article', { signal: controller.signal }),
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('fetchRemoteText remained pending during DNS abort')), 20)
      })
    ])

    controller.abort(new Error('dns aborted'))

    await expect(result).rejects.toThrow('dns aborted')
    expect(httpRequestMock).not.toHaveBeenCalled()
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('preserves the abort signal reason when the HTTP request reports a generic abort error', async () => {
    httpsRequestMock.mockImplementation((options: RequestOptions) => {
      const request = Object.assign(new EventEmitter(), {
        end: vi.fn(),
        destroy: vi.fn()
      })

      options.signal?.addEventListener('abort', () => {
        const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
        request.emit('error', abortError)
      })

      return request
    })

    await expect(fetchRemoteText('https://example.com/article', { timeoutMs: 1 })).rejects.toMatchObject({
      name: 'TimeoutError'
    })
  })

  it('rejects promptly when DNS resolution exceeds the fetch timeout', async () => {
    lookupMock.mockReturnValue(new Promise(() => undefined))

    const result = Promise.race([
      fetchRemoteText('https://example.com/article', { timeoutMs: 1 }),
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('fetchRemoteText remained pending while resolving DNS')), 20)
      })
    ])

    await expect(result).rejects.toThrow(/timeout|aborted/i)
    expect(httpRequestMock).not.toHaveBeenCalled()
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('pins public IPv6 literals without sending an IP literal as TLS SNI', async () => {
    mockHttpsResponse({ body: 'hello' })

    await expect(fetchRemoteText('https://[2001:4860:4860::8888]/file')).resolves.toBe('hello')

    const requestOptions = httpsRequestMock.mock.calls[0]?.[0] as RequestOptions
    expect(requestOptions.hostname).toBe('2001:4860:4860::8888')
    expect(requestOptions.servername).toBeUndefined()
    expect(requestOptions.headers).toMatchObject({ host: '[2001:4860:4860::8888]' })
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects redirects without following them or buffering the response body', async () => {
    const { response } = mockHttpsResponse({
      body: Buffer.alloc(1024 * 1024 * 2),
      statusCode: 302
    })

    await expect(fetchRemoteText('https://example.com/redirect')).rejects.toThrow('HTTP error: 302')

    expect(response.listenerCount('data')).toBe(0)
    expect(response.resume).toHaveBeenCalledOnce()
    expect(response.destroy).toHaveBeenCalledOnce()
  })

  it('follows an opted-in redirect through a newly validated and pinned connection', async () => {
    const redirectResponse = Object.assign(new EventEmitter(), {
      statusCode: 302,
      headers: { location: 'https://cdn.example.com/article' },
      resume: vi.fn(),
      destroy: vi.fn()
    }) as IncomingMessage & { resume: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
    const finalResponse = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: {},
      resume: vi.fn(),
      destroy: vi.fn()
    }) as IncomingMessage & { resume: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
    const requests = [redirectResponse, finalResponse]
    httpsRequestMock.mockImplementation((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      const response = requests.shift()
      if (!response) throw new Error('Unexpected HTTPS request')

      queueMicrotask(() => {
        callback(response)
        if (response === finalResponse) {
          response.emit('data', Buffer.from('redirected content'))
          response.emit('end')
        }
      })

      return Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn(), options })
    })
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }])

    await expect(
      fetchRemoteText('https://example.com/start', {
        headers: {
          Authorization: 'Bearer secret',
          Cookie: 'session=secret',
          'User-Agent': 'Custom Agent'
        },
        maxRedirects: 1
      })
    ).resolves.toBe('redirected content')

    expect(lookupMock).toHaveBeenNthCalledWith(1, 'example.com', { all: true })
    expect(lookupMock).toHaveBeenNthCalledWith(2, 'cdn.example.com', { all: true })
    expect(httpsRequestMock).toHaveBeenCalledTimes(2)

    const initialOptions = httpsRequestMock.mock.calls[0]?.[0] as RequestOptions
    const redirectedOptions = httpsRequestMock.mock.calls[1]?.[0] as RequestOptions
    expect(initialOptions.headers).toMatchObject({
      authorization: 'Bearer secret',
      cookie: 'session=secret',
      'user-agent': 'Custom Agent'
    })
    expect(redirectedOptions.headers).toMatchObject({ host: 'cdn.example.com', 'user-agent': 'Custom Agent' })
    expect(redirectedOptions.headers).not.toHaveProperty('authorization')
    expect(redirectedOptions.headers).not.toHaveProperty('cookie')
    expect(redirectedOptions.signal).toBe(initialOptions.signal)

    const callback = vi.fn()
    redirectedOptions.lookup?.('cdn.example.com', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '1.1.1.1', 4)
  })

  it('rejects a redirect whose destination resolves to a private address before opening the next request', async () => {
    const redirectResponse = Object.assign(new EventEmitter(), {
      statusCode: 302,
      headers: { location: 'https://private.example/article' },
      resume: vi.fn(),
      destroy: vi.fn()
    }) as IncomingMessage & { resume: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
    httpsRequestMock.mockImplementation((_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      queueMicrotask(() => callback(redirectResponse))
      return Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() })
    })
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }])

    await expect(fetchRemoteText('https://example.com/start', { maxRedirects: 1 })).rejects.toThrow(/DNS resolved/)

    expect(httpsRequestMock).toHaveBeenCalledOnce()
    expect(redirectResponse.listenerCount('data')).toBe(0)
  })

  it('stops after the configured number of redirects without buffering the excess response', async () => {
    const responses = Array.from({ length: 2 }, () =>
      Object.assign(new EventEmitter(), {
        statusCode: 302,
        headers: { location: '/next' },
        resume: vi.fn(),
        destroy: vi.fn()
      })
    ) as Array<IncomingMessage & { resume: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>
    httpsRequestMock.mockImplementation((_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      const response = responses[httpsRequestMock.mock.calls.length - 1]
      if (!response) throw new Error('Unexpected HTTPS request')
      queueMicrotask(() => callback(response))
      return Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() })
    })

    await expect(fetchRemoteText('https://example.com/start', { maxRedirects: 1 })).rejects.toThrow('HTTP error: 302')

    expect(httpsRequestMock).toHaveBeenCalledTimes(2)
    expect(responses[1]?.listenerCount('data')).toBe(0)
    expect(responses[1]?.resume).toHaveBeenCalledOnce()
    expect(responses[1]?.destroy).toHaveBeenCalledOnce()
  })

  it('rejects non-2xx responses before registering body accumulation', async () => {
    const { response } = mockHttpsResponse({
      body: Buffer.alloc(1024 * 1024 * 2),
      statusCode: 500
    })

    await expect(fetchRemoteText('https://example.com/error')).rejects.toThrow('HTTP error: 500')

    expect(response.listenerCount('data')).toBe(0)
    expect(response.resume).toHaveBeenCalledOnce()
    expect(response.destroy).toHaveBeenCalledOnce()
  })

  it('rejects oversized responses from content-length before buffering', async () => {
    const { response } = mockHttpsResponse({
      body: Buffer.alloc(1024 * 1024 * 2),
      headers: { 'content-length': String(1024 * 1024 * 2) }
    })

    await expect(fetchRemoteText('https://example.com/large', { maxBytes: 1024 })).rejects.toThrow(
      /Remote response too large/
    )

    expect(response.listenerCount('data')).toBe(0)
    expect(response.resume).toHaveBeenCalledOnce()
    expect(response.destroy).toHaveBeenCalledOnce()
  })

  it('rejects streaming responses that exceed the byte limit', async () => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: {},
      resume: vi.fn(),
      destroy: vi.fn()
    }) as IncomingMessage & { resume: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn()
    })
    httpsRequestMock.mockImplementation((_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      queueMicrotask(() => {
        callback(response)
        response.emit('data', Buffer.from('hello'))
        response.emit('data', Buffer.from('world'))
        response.emit('end')
      })

      return request
    })

    await expect(fetchRemoteText('https://example.com/stream', { maxBytes: 8 })).rejects.toThrow(
      /Remote response too large/
    )

    expect(response.destroy).toHaveBeenCalledOnce()
  })

  it.each([
    ['aborted', 'Remote response aborted before completion'],
    ['close', 'Remote response closed before completion']
  ] as const)('rejects responses that emit %s before ending', async (eventName, expectedError) => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: {},
      resume: vi.fn(),
      destroy: vi.fn()
    }) as IncomingMessage & { resume: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn()
    })
    httpsRequestMock.mockImplementation((_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      queueMicrotask(() => {
        callback(response)
        response.emit('data', Buffer.from('partial'))
        response.emit(eventName)
      })

      return request
    })

    const result = Promise.race([
      fetchRemoteText('https://example.com/aborted'),
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('fetchRemoteText remained pending')), 20)
      })
    ])

    await expect(result).rejects.toThrow(expectedError)
  })
})
