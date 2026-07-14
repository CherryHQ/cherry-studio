import type { MockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CitationPreviewModule from '../CitationPreviewService'

const fetchRemoteTextMock = vi.hoisted(() => vi.fn())
let mockMainLoggerService: MockMainLoggerService
let fetchPreview: typeof CitationPreviewModule.citationPreviewService.fetchPreview

vi.mock('@main/utils/remoteFetch', () => ({
  fetchRemoteText: fetchRemoteTextMock
}))

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

describe('CitationPreviewService', () => {
  beforeEach(async () => {
    vi.resetModules()
    fetchRemoteTextMock.mockReset()
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
    fetchRemoteTextMock.mockResolvedValue(body)

    await expect(fetchPreview('https://example.com')).resolves.toBe(`Visible ${'x'.repeat(92)}...`)

    const [safeUrl, requestInit] = fetchRemoteTextMock.mock.calls[0]
    expect(safeUrl).toBe('https://example.com/')
    expect(requestInit).toEqual({
      headers: { 'User-Agent': USER_AGENT },
      timeoutMs: 8000,
      maxBytes: MAX_RESPONSE_BYTES,
      maxRedirects: 5
    })
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
    fetchRemoteTextMock.mockResolvedValue(html)

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
    fetchRemoteTextMock.mockResolvedValue(xhtml)

    await expect(fetchPreview('https://example.com/article.xhtml')).resolves.toBe(
      'XHTML headline The citation preview is extracted from XHTML content'
    )
  })

  it('keeps the main event loop responsive while parsing a large HTML response', async () => {
    const paragraph = '<p>The citation preview contains readable article text for the worker regression.</p>'
    const html = `<!doctype html><html><body><article>${paragraph.repeat(10_000)}</article></body></html>`
    fetchRemoteTextMock.mockResolvedValue(html)
    let settled = false

    const previewPromise = fetchPreview('https://example.com/large-article').finally(() => {
      settled = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(settled).toBe(false)
    await expect(previewPromise).resolves.toContain('The citation preview contains readable article text')
  })

  it('rejects private and invalid URLs before calling the remote fetch helper', async () => {
    await expect(fetchPreview('http://127.0.0.1/private')).resolves.toBe('')
    await expect(fetchPreview('not a URL')).resolves.toBe('')

    expect(fetchRemoteTextMock).not.toHaveBeenCalled()
  })

  it('shares in-flight requests for the same sanitized URL without caching completed results', async () => {
    const deferredResponse = createDeferred<string>()
    fetchRemoteTextMock.mockImplementationOnce(() => deferredResponse.promise)
    fetchRemoteTextMock.mockResolvedValueOnce('fresh preview')

    const firstRequest = fetchPreview('https://EXAMPLE.com:443/single-flight')
    const secondRequest = fetchPreview('https://example.com/single-flight')

    expect(secondRequest).toBe(firstRequest)
    expect(fetchRemoteTextMock).toHaveBeenCalledOnce()

    deferredResponse.resolve('shared preview')
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual(['shared preview', 'shared preview'])

    await expect(fetchPreview('https://example.com/single-flight')).resolves.toBe('fresh preview')
    expect(fetchRemoteTextMock).toHaveBeenCalledTimes(2)
  })

  it('limits concurrency to three and starts the fourth request only after dequeue', async () => {
    const deferredResponses = Array.from({ length: 4 }, () => createDeferred<string>())
    let fetchIndex = 0
    let activeFetches = 0
    let maxActiveFetches = 0

    fetchRemoteTextMock.mockImplementation(async () => {
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
      expect(fetchRemoteTextMock).toHaveBeenCalledTimes(3)
    })

    deferredResponses[0].resolve('preview 1')
    await vi.waitFor(() => {
      expect(fetchRemoteTextMock).toHaveBeenCalledTimes(4)
    })

    deferredResponses[1].resolve('preview 2')
    deferredResponses[2].resolve('preview 3')
    deferredResponses[3].resolve('preview 4')

    await expect(Promise.all(requests)).resolves.toEqual(['preview 1', 'preview 2', 'preview 3', 'preview 4'])
    expect(maxActiveFetches).toBe(3)
  })

  it('releases a queue slot when an active fetch times out', async () => {
    const deferredResponses = Array.from({ length: 4 }, () => createDeferred<string>())
    let fetchIndex = 0
    fetchRemoteTextMock.mockImplementation(() => {
      const deferredResponse = deferredResponses[fetchIndex]
      fetchIndex += 1
      if (!deferredResponse) {
        throw new Error('Unexpected fetch call')
      }

      return deferredResponse.promise
    })

    const requests = Array.from({ length: 4 }, (_, index) => fetchPreview(`https://example.com/timeout/${index + 1}`))

    await vi.waitFor(() => {
      expect(fetchRemoteTextMock).toHaveBeenCalledTimes(3)
    })

    const abortError = new Error('request timed out')
    abortError.name = 'AbortError'
    deferredResponses[0].reject(abortError)
    await expect(requests[0]).resolves.toBe('')

    await vi.waitFor(() => {
      expect(fetchRemoteTextMock).toHaveBeenCalledTimes(4)
    })

    deferredResponses[3].resolve('preview 4')
    await expect(requests[3]).resolves.toBe('preview 4')

    deferredResponses[1].resolve('preview 2')
    deferredResponses[2].resolve('preview 3')
    await expect(Promise.all(requests)).resolves.toEqual(['', 'preview 2', 'preview 3', 'preview 4'])
  })

  it('redacts URL path, query, and the original error message from network error logs', async () => {
    const secret = 'citation-secret-value'
    const path = '/private/citation/path'
    const url = `https://example.com${path}?access_token=${secret}`
    fetchRemoteTextMock.mockRejectedValue(new Error(`network unavailable for ${url}`))

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

  it('returns empty when the remote fetch helper rejects', async () => {
    fetchRemoteTextMock.mockRejectedValue(new Error('HTTP error: 503'))

    await expect(fetchPreview('https://example.com/http-error')).resolves.toBe('')
  })
})
