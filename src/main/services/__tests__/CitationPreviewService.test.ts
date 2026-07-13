import type { MockMainLoggerService } from '@test-mocks/MainLoggerService'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CitationPreviewModule from '../CitationPreviewService'

const fetchMock = vi.mocked(net.fetch)
let mockMainLoggerService: MockMainLoggerService
let fetchPreview: typeof CitationPreviewModule.citationPreviewService.fetchPreview

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MAX_RESPONSE_BYTES = 1024 * 1024

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

function createTextResponse(body: BodyInit, headers: HeadersInit = { 'content-type': 'text/plain' }): Response {
  return new Response(body, { status: 200, headers })
}

describe('CitationPreviewService', () => {
  beforeEach(async () => {
    vi.resetModules()
    fetchMock.mockReset()
    const { loggerService } = await import('@logger')
    mockMainLoggerService = loggerService as unknown as MockMainLoggerService
    mockMainLoggerService.error.mockClear()
    const citationPreviewModule = await import('../CitationPreviewService')
    fetchPreview = citationPreviewModule.citationPreviewService.fetchPreview.bind(
      citationPreviewModule.citationPreviewService
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cleans plain text, compresses whitespace, and truncates display text to 100 characters', async () => {
    const body = `![hero](https://example.com/hero.png)\n[Visible](https://example.com/link)\nhttps://hidden.test --- ${'x'.repeat(110)}`
    fetchMock.mockResolvedValue(createTextResponse(body))

    await expect(fetchPreview('https://example.com')).resolves.toBe(`Visible ${'x'.repeat(92)}...`)

    const [safeUrl, requestInit] = fetchMock.mock.calls[0]
    expect(safeUrl).toBe('https://example.com/')
    expect(new Headers(requestInit?.headers).get('User-Agent')).toBe(USER_AGENT)
  })

  it('disables automatic redirects for remote fetches', async () => {
    fetchMock.mockResolvedValue(createTextResponse('preview'))

    await fetchPreview('https://example.com/redirect-target')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/redirect-target',
      expect.objectContaining({ redirect: 'error' })
    )
  })

  it('extracts article text from real HTML with Readability', async () => {
    const html = `
      <!doctype html>
      <html>
        <head><title>Example article</title></head>
        <body>
          <nav>Navigation that is not part of the article</nav>
          <article>
            <h1>Readable headline</h1>
            <p>The primary citation sentence is extracted from the article body.</p>
          </article>
          <footer>Footer that is not part of the article</footer>
        </body>
      </html>
    `
    fetchMock.mockResolvedValue(createTextResponse(html, { 'content-type': 'text/html; charset=utf-8' }))

    await expect(fetchPreview('https://example.com/article')).resolves.toBe(
      'Readable headline The primary citation sentence is extracted from the article body'
    )
  })

  it('extracts article text from XHTML with Readability', async () => {
    const xhtml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>XHTML article</title></head>
        <body>
          <article>
            <h1>XHTML headline</h1>
            <p>The citation preview is extracted from XHTML content.</p>
          </article>
        </body>
      </html>
    `
    fetchMock.mockResolvedValue(createTextResponse(xhtml, { 'content-type': 'application/xhtml+xml' }))

    await expect(fetchPreview('https://example.com/article.xhtml')).resolves.toBe(
      'XHTML headline The citation preview is extracted from XHTML content'
    )
  })

  it('rejects private and invalid URLs before calling net.fetch', async () => {
    await expect(fetchPreview('http://127.0.0.1/private')).resolves.toBe('')
    await expect(fetchPreview('not a URL')).resolves.toBe('')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-text response', { 'content-type': 'image/png' }],
    ['a response without content-type', {}]
  ])('returns empty for %s', async (_case, headers) => {
    fetchMock.mockResolvedValue(createTextResponse(new Uint8Array([1, 2, 3]), headers))

    await expect(fetchPreview(`https://example.com/${encodeURIComponent(_case)}`)).resolves.toBe('')
  })

  it('cancels a non-text response body before returning empty', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    fetchMock.mockResolvedValue(createTextResponse(body, { 'content-type': 'image/png' }))

    await expect(fetchPreview('https://example.com/non-text-body')).resolves.toBe('')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects a declared oversized response before reading its body', async () => {
    const pull = vi.fn()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 })
    fetchMock.mockResolvedValue(
      createTextResponse(body, {
        'content-type': 'text/plain',
        'content-length': String(MAX_RESPONSE_BYTES + 1)
      })
    )

    await expect(fetchPreview('https://example.com/declared-large')).resolves.toBe('')
    expect(pull).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects an oversized decimal content-length beyond Number.MAX_SAFE_INTEGER before reading', async () => {
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(new TextEncoder().encode('body must not be read'))
      controller.close()
    })
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 })
    fetchMock.mockResolvedValue(
      createTextResponse(body, {
        'content-type': 'text/plain',
        'content-length': '999999999999999999999999999999999999'
      })
    )

    await expect(fetchPreview('https://example.com/declared-huge')).resolves.toBe('')
    expect(pull).not.toHaveBeenCalled()
  })

  it('cancels an undeclared response stream after it exceeds 1 MiB', async () => {
    const cancel = vi.fn()
    const chunks = [new Uint8Array(600 * 1024), new Uint8Array(600 * 1024)]
    let chunkIndex = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[chunkIndex]
        chunkIndex += 1

        if (chunk) {
          controller.enqueue(chunk)
        }
      },
      cancel
    })
    fetchMock.mockResolvedValue(createTextResponse(body))

    await expect(fetchPreview('https://example.com/streamed-large')).resolves.toBe('')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('shares in-flight requests for the same sanitized URL without caching completed results', async () => {
    const deferredResponse = createDeferred<Response>()
    fetchMock.mockImplementationOnce(() => deferredResponse.promise)
    fetchMock.mockResolvedValueOnce(createTextResponse('fresh preview'))

    const firstRequest = fetchPreview('https://EXAMPLE.com:443/single-flight')
    const secondRequest = fetchPreview('https://example.com/single-flight')

    expect(secondRequest).toBe(firstRequest)
    expect(fetchMock).toHaveBeenCalledOnce()

    deferredResponse.resolve(createTextResponse('shared preview'))
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual(['shared preview', 'shared preview'])

    await expect(fetchPreview('https://example.com/single-flight')).resolves.toBe('fresh preview')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('limits concurrency to three and creates the fourth timeout only after dequeue', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const deferredResponses = Array.from({ length: 4 }, () => createDeferred<Response>())
    let fetchIndex = 0
    let activeFetches = 0
    let maxActiveFetches = 0

    fetchMock.mockImplementation(async () => {
      const deferredResponse = deferredResponses[fetchIndex]
      fetchIndex += 1
      if (!deferredResponse) {
        throw new Error('Unexpected fetch call')
      }

      activeFetches += 1
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches)
      try {
        return await deferredResponse.promise
      } finally {
        activeFetches -= 1
      }
    })

    const requests = Array.from({ length: 4 }, (_, index) => fetchPreview(`https://example.com/queued/${index + 1}`))

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    expect(timeoutSpy).toHaveBeenCalledTimes(3)
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 8000)
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 8000)
    expect(timeoutSpy).toHaveBeenNthCalledWith(3, 8000)

    deferredResponses[0].resolve(createTextResponse('preview 1'))
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })
    expect(timeoutSpy).toHaveBeenCalledTimes(4)
    expect(timeoutSpy).toHaveBeenNthCalledWith(4, 8000)

    deferredResponses[1].resolve(createTextResponse('preview 2'))
    deferredResponses[2].resolve(createTextResponse('preview 3'))
    deferredResponses[3].resolve(createTextResponse('preview 4'))

    await expect(Promise.all(requests)).resolves.toEqual(['preview 1', 'preview 2', 'preview 3', 'preview 4'])
    expect(maxActiveFetches).toBe(3)
  })

  it('releases a queue slot when an active fetch times out', async () => {
    const timeoutControllers = Array.from({ length: 4 }, () => new AbortController())
    let timeoutIndex = 0
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      expect(milliseconds).toBe(8000)
      const controller = timeoutControllers[timeoutIndex]
      timeoutIndex += 1
      if (!controller) {
        throw new Error('Unexpected timeout creation')
      }
      return controller.signal
    })

    const deferredResponses = Array.from({ length: 4 }, () => createDeferred<Response>())
    let fetchIndex = 0
    fetchMock.mockImplementation((_url, requestInit) => {
      const deferredResponse = deferredResponses[fetchIndex]
      fetchIndex += 1
      if (!deferredResponse) {
        throw new Error('Unexpected fetch call')
      }

      return new Promise<Response>((resolve, reject) => {
        requestInit?.signal?.addEventListener(
          'abort',
          () => {
            const abortError = new Error('request timed out')
            abortError.name = 'AbortError'
            reject(abortError)
          },
          { once: true }
        )
        void deferredResponse.promise.then(resolve, reject)
      })
    })

    const requests = Array.from({ length: 4 }, (_, index) => fetchPreview(`https://example.com/timeout/${index + 1}`))

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    expect(timeoutIndex).toBe(3)

    timeoutControllers[0].abort()
    await expect(requests[0]).resolves.toBe('')

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })
    expect(timeoutIndex).toBe(4)

    deferredResponses[3].resolve(createTextResponse('preview 4'))
    await expect(requests[3]).resolves.toBe('preview 4')

    deferredResponses[1].resolve(createTextResponse('preview 2'))
    deferredResponses[2].resolve(createTextResponse('preview 3'))
    await expect(Promise.all(requests)).resolves.toEqual(['', 'preview 2', 'preview 3', 'preview 4'])
  })

  it('redacts URL path, query, and the original error message from network error logs', async () => {
    const secret = 'citation-secret-value'
    const path = '/private/citation/path'
    const url = `https://example.com${path}?access_token=${secret}`
    fetchMock.mockRejectedValue(new Error(`network unavailable for ${url}`))

    await expect(fetchPreview(url)).resolves.toBe('')

    expect(mockMainLoggerService.error).toHaveBeenCalledWith('Failed to fetch citation preview', {
      origin: 'https://example.com',
      errorName: 'Error'
    })

    const serializedLogArguments = JSON.stringify(mockMainLoggerService.error.mock.calls)
    expect(serializedLogArguments).not.toContain(secret)
    expect(serializedLogArguments).not.toContain(path)
    expect(serializedLogArguments).not.toContain('access_token')
  })

  it('returns empty for an HTTP error response', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    fetchMock.mockResolvedValue(new Response(body, { status: 503 }))

    await expect(fetchPreview('https://example.com/http-error')).resolves.toBe('')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('returns empty when response body cancellation fails', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('cancel failed'))
    const body = new ReadableStream<Uint8Array>({ cancel })
    fetchMock.mockResolvedValue(createTextResponse(body, { 'content-type': 'application/octet-stream' }))

    await expect(fetchPreview('https://example.com/cancel-error')).resolves.toBe('')
    expect(cancel).toHaveBeenCalledOnce()
  })
})
