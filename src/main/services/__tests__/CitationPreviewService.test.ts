import type { MockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CitationPreviewService as CitationPreviewServiceType } from '../CitationPreviewService'

const fetchRemoteTextMock = vi.hoisted(() => vi.fn())
const extractPreviewTextMock = vi.hoisted(() => vi.fn())
let mockMainLoggerService: MockMainLoggerService
let service: CitationPreviewServiceType

vi.mock('@main/services/readableContent', () => ({
  readableContentService: { extractPreviewText: extractPreviewTextMock }
}))

vi.mock('@main/utils/remoteFetch', () => ({
  fetchRemoteText: fetchRemoteTextMock
}))

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MAX_RESPONSE_BYTES = 1024 * 1024

const requestContext = (requestId: string, senderId = 'window-1') => ({ requestId, senderId })

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

describe('CitationPreviewService', () => {
  beforeEach(async () => {
    vi.resetModules()
    fetchRemoteTextMock.mockReset()
    extractPreviewTextMock.mockReset()
    extractPreviewTextMock.mockImplementation(async (source: string) => source)
    const { loggerService } = await import('@logger')
    mockMainLoggerService = loggerService as unknown as MockMainLoggerService
    mockMainLoggerService.error.mockClear()
    const { BaseService } = await import('@main/core/lifecycle')
    BaseService.resetInstances()
    const citationPreviewModule = await import('../CitationPreviewService')
    service = new citationPreviewModule.CitationPreviewService()
    await service._doInit()
  })

  afterEach(async () => {
    await service._doStop()
    vi.restoreAllMocks()
  })

  it('formats plain text in the worker and returns its bounded preview', async () => {
    const body = `![hero](https://example.com/hero.png)\n[Visible](https://example.com/link)\nhttps://hidden.test --- ${'x'.repeat(110)}`
    fetchRemoteTextMock.mockResolvedValue(body)
    extractPreviewTextMock.mockResolvedValue(`Visible ${'x'.repeat(92)}...`)

    await expect(service.fetchPreview('https://example.com', requestContext('request-1'))).resolves.toBe(
      `Visible ${'x'.repeat(92)}...`
    )

    const [safeUrl, requestInit] = fetchRemoteTextMock.mock.calls[0]
    expect(safeUrl).toBe('https://example.com/')
    expect(requestInit).toEqual({
      headers: { 'User-Agent': USER_AGENT },
      signal: expect.any(AbortSignal),
      timeoutMs: 8000,
      maxBytes: MAX_RESPONSE_BYTES,
      maxRedirects: 5
    })
    expect(extractPreviewTextMock).toHaveBeenCalledWith(body, {
      inputKind: 'html',
      maxLength: 100,
      signal: requestInit.signal
    })
  })

  it.each([
    ['title and list', '<title>Foo</title><ul><li>Hello</li></ul>'],
    ['preformatted text', '<pre>Hello</pre>']
  ])('routes minimal HTML with %s through the HTML parser', async (_name, body) => {
    fetchRemoteTextMock.mockResolvedValue(body)
    extractPreviewTextMock.mockResolvedValue('Hello')

    await expect(service.fetchPreview('https://example.com/minimal', requestContext('request-1'))).resolves.toBe(
      'Hello'
    )

    const signal = fetchRemoteTextMock.mock.calls[0]?.[1]?.signal as AbortSignal
    expect(extractPreviewTextMock).toHaveBeenCalledWith(body, {
      inputKind: 'html',
      maxLength: 100,
      signal
    })
  })

  it('extracts HTML through the shared worker with the task abort signal', async () => {
    const html = '<!doctype html><html><body><article><p>Article</p></article></body></html>'
    fetchRemoteTextMock.mockResolvedValue(html)
    extractPreviewTextMock.mockResolvedValue('Readable article text')

    await expect(service.fetchPreview('https://example.com/article', requestContext('request-1'))).resolves.toBe(
      'Readable article text'
    )

    const signal = fetchRemoteTextMock.mock.calls[0]?.[1]?.signal as AbortSignal
    expect(extractPreviewTextMock).toHaveBeenCalledWith(html, {
      inputKind: 'html',
      maxLength: 100,
      signal
    })
  })

  it('rejects private and invalid URLs before calling the remote fetch helper', async () => {
    await expect(service.fetchPreview('http://127.0.0.1/private', requestContext('request-1'))).resolves.toBe('')
    await expect(service.fetchPreview('not a URL', requestContext('request-2'))).resolves.toBe('')

    expect(fetchRemoteTextMock).not.toHaveBeenCalled()
  })

  it('shares one underlying task for the same sanitized URL across subscribers', async () => {
    const deferredResponse = createDeferred<string>()
    fetchRemoteTextMock.mockImplementationOnce(() => deferredResponse.promise)

    const firstRequest = service.fetchPreview(
      'https://EXAMPLE.com:443/single-flight',
      requestContext('panel-a', 'window-a')
    )
    const secondRequest = service.fetchPreview(
      'https://example.com/single-flight',
      requestContext('panel-b', 'window-b')
    )

    expect(fetchRemoteTextMock).toHaveBeenCalledOnce()
    deferredResponse.resolve('shared preview')

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual(['shared preview', 'shared preview'])
  })

  it('drops URL fragments before identifying and fetching a shared preview job', async () => {
    const deferredResponse = createDeferred<string>()
    fetchRemoteTextMock.mockImplementationOnce(() => deferredResponse.promise)

    const firstRequest = service.fetchPreview(
      'https://example.com/article?lang=en#introduction',
      requestContext('panel-a', 'window-a')
    )
    const secondRequest = service.fetchPreview(
      'https://example.com/article?lang=en#details',
      requestContext('panel-b', 'window-b')
    )

    expect(fetchRemoteTextMock).toHaveBeenCalledOnce()
    expect(fetchRemoteTextMock).toHaveBeenCalledWith(
      'https://example.com/article?lang=en',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )

    deferredResponse.resolve('shared preview')
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual(['shared preview', 'shared preview'])
  })

  it('keeps a shared task alive when only one subscriber cancels', async () => {
    const deferredResponse = createDeferred<string>()
    let taskSignal: AbortSignal | undefined
    fetchRemoteTextMock.mockImplementation((_url, options) => {
      taskSignal = options.signal
      return deferredResponse.promise
    })

    const firstContext = requestContext('panel-a', 'window-a')
    const secondContext = requestContext('panel-b', 'window-b')
    const firstRequest = service.fetchPreview('https://example.com/shared', firstContext)
    const secondRequest = service.fetchPreview('https://example.com/shared', secondContext)

    service.cancelPreviews(firstContext)

    await expect(firstRequest).resolves.toBe('')
    expect(taskSignal?.aborted).toBe(false)

    deferredResponse.resolve('shared preview')
    await expect(secondRequest).resolves.toBe('shared preview')
  })

  it('aborts the underlying task when its last subscriber cancels', async () => {
    let taskSignal: AbortSignal | undefined
    fetchRemoteTextMock.mockImplementation((_url, options) => {
      taskSignal = options.signal
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    })
    const context = requestContext('panel-a')
    const request = service.fetchPreview('https://example.com/active', context)

    service.cancelPreviews(context)

    await expect(request).resolves.toBe('')
    expect(taskSignal?.aborted).toBe(true)
  })

  it('starts a fresh task when a new subscriber arrives while the cancelled task is still settling', async () => {
    let rejectCancelledTask!: (reason?: unknown) => void
    fetchRemoteTextMock
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectCancelledTask = reject
          })
      )
      .mockResolvedValueOnce('fresh preview')
    const cancelledContext = requestContext('panel-a')
    const cancelledRequest = service.fetchPreview('https://example.com/reopen', cancelledContext)

    await vi.waitFor(() => expect(fetchRemoteTextMock).toHaveBeenCalledOnce())
    service.cancelPreviews(cancelledContext)
    await expect(cancelledRequest).resolves.toBe('')

    const freshRequest = service.fetchPreview('https://example.com/reopen', requestContext('panel-b'))

    try {
      await vi.waitFor(() => expect(fetchRemoteTextMock).toHaveBeenCalledTimes(2))
      await expect(freshRequest).resolves.toBe('fresh preview')
    } finally {
      rejectCancelledTask(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
    }
  })

  it('removes a cancelled queued task before it starts', async () => {
    const deferredResponses = Array.from({ length: 3 }, () => createDeferred<string>())
    let fetchIndex = 0
    fetchRemoteTextMock.mockImplementation(() => deferredResponses[fetchIndex++].promise)

    const activeRequests = Array.from({ length: 3 }, (_, index) =>
      service.fetchPreview(`https://example.com/active/${index}`, requestContext(`active-${index}`))
    )
    const queuedContext = requestContext('queued')
    const queuedRequest = service.fetchPreview('https://example.com/queued', queuedContext)

    await vi.waitFor(() => expect(fetchRemoteTextMock).toHaveBeenCalledTimes(3))
    service.cancelPreviews(queuedContext)

    await expect(queuedRequest).resolves.toBe('')
    expect(fetchRemoteTextMock).toHaveBeenCalledTimes(3)

    deferredResponses.forEach((deferred, index) => deferred.resolve(`preview ${index}`))
    await Promise.all(activeRequests)
  })

  it('limits concurrency to three and starts the fourth request only after dequeue', async () => {
    const deferredResponses = Array.from({ length: 4 }, () => createDeferred<string>())
    let fetchIndex = 0
    fetchRemoteTextMock.mockImplementation(() => deferredResponses[fetchIndex++].promise)

    const requests = Array.from({ length: 4 }, (_, index) =>
      service.fetchPreview(`https://example.com/queued/${index + 1}`, requestContext(`request-${index + 1}`))
    )

    await vi.waitFor(() => expect(fetchRemoteTextMock).toHaveBeenCalledTimes(3))
    deferredResponses[0].resolve('preview 1')
    await vi.waitFor(() => expect(fetchRemoteTextMock).toHaveBeenCalledTimes(4))

    deferredResponses[1].resolve('preview 2')
    deferredResponses[2].resolve('preview 3')
    deferredResponses[3].resolve('preview 4')
    await expect(Promise.all(requests)).resolves.toEqual(['preview 1', 'preview 2', 'preview 3', 'preview 4'])
  })

  it('aborts all active work when the lifecycle service stops', async () => {
    let taskSignal: AbortSignal | undefined
    fetchRemoteTextMock.mockImplementation((_url, options) => {
      taskSignal = options.signal
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    })
    const request = service.fetchPreview('https://example.com/active', requestContext('panel-a'))

    await service._doStop()

    await expect(request).resolves.toBe('')
    expect(taskSignal?.aborted).toBe(true)
  })

  it('waits for an aborted underlying fetch to settle before stop completes', async () => {
    let rejectFetch!: (reason?: unknown) => void
    let taskSignal: AbortSignal | undefined
    fetchRemoteTextMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          taskSignal = options.signal
          rejectFetch = reject
        })
    )
    const request = service.fetchPreview('https://example.com/delayed-abort', requestContext('panel-a'))

    await vi.waitFor(() => expect(fetchRemoteTextMock).toHaveBeenCalledOnce())
    let stopCompleted = false
    const stop = service._doStop().then(() => {
      stopCompleted = true
    })

    await vi.waitFor(() => expect(taskSignal?.aborted).toBe(true))
    await expect(request).resolves.toBe('')
    expect(stopCompleted).toBe(false)

    rejectFetch(taskSignal?.reason)
    await stop
    expect(stopCompleted).toBe(true)
  })

  it('does not start preview work after the service stops', async () => {
    await service._doStop()
    fetchRemoteTextMock.mockClear()

    await expect(service.fetchPreview('https://example.com/stopped', requestContext('panel-a'))).resolves.toBe('')

    expect(fetchRemoteTextMock).not.toHaveBeenCalled()
  })

  it('supports idempotent teardown and starts accepting work again after re-initialization', async () => {
    await Promise.all([service._doStop(), service._doStop()])
    await service._doInit()
    fetchRemoteTextMock.mockResolvedValue('preview after restart')

    await expect(service.fetchPreview('https://example.com/restarted', requestContext('panel-a'))).resolves.toBe(
      'preview after restart'
    )

    await service._doStop()
    await service._doDestroy()
    await service._doDestroy()
  })

  it('redacts URL path, query, and the original error message from network error logs', async () => {
    const secret = 'citation-secret-value'
    const path = '/private/citation/path'
    const url = `https://example.com${path}?access_token=${secret}`
    fetchRemoteTextMock.mockRejectedValue(new Error(`network unavailable for ${url}`))

    await expect(service.fetchPreview(url, requestContext('request-1'))).resolves.toBe('')

    expect(mockMainLoggerService.error).toHaveBeenCalledWith('Failed to fetch citation preview', {
      origin: 'https://example.com',
      errorName: 'Error'
    })

    const serializedLogArguments = JSON.stringify(mockMainLoggerService.error.mock.calls)
    expect(serializedLogArguments).not.toContain(secret)
    expect(serializedLogArguments).not.toContain(path)
    expect(serializedLogArguments).not.toContain('access_token')
  })
})
