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

  it('rejects hostnames that resolve to private addresses before opening a request', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])

    await expect(fetchRemoteText('https://example.com/article')).rejects.toThrow(/DNS resolved/)

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
