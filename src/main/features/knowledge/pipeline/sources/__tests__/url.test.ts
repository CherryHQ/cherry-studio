import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchUrlsUnprocessedMock = vi.hoisted(() => vi.fn())

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    WebSearchService: { fetchUrlsUnprocessed: fetchUrlsUnprocessedMock }
  } as never)
})

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

const { fetchKnowledgeWebPage } = await import('../url')

function fetchResponse(url: string, content: string, title: string = url) {
  return {
    query: url,
    providerId: 'jina',
    capability: 'fetchUrls',
    inputs: [url],
    results: [{ title, content, url, sourceInput: url }]
  }
}

function fetchedPage(url: string, markdown: string, title: string = url) {
  return { title, markdown }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('fetchKnowledgeWebPage', () => {
  beforeEach(() => {
    vi.useRealTimers()
    fetchUrlsUnprocessedMock.mockReset()
  })

  it('fetches a page and returns markdown content', async () => {
    fetchUrlsUnprocessedMock.mockResolvedValue(
      fetchResponse('https://example.com', '# Example Page\n\nHello knowledge', 'Example Page')
    )

    const controller = new AbortController()

    await expect(fetchKnowledgeWebPage('https://example.com', controller.signal)).resolves.toEqual(
      fetchedPage('https://example.com', '# Example Page\n\nHello knowledge', 'Example Page')
    )

    expect(fetchUrlsUnprocessedMock).toHaveBeenCalledWith(
      { providerId: 'jina', urls: ['https://example.com'] },
      { signal: expect.any(AbortSignal) }
    )
  })

  it('rejects before execution when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('fetch aborted'))

    await expect(fetchKnowledgeWebPage('https://example.com', controller.signal)).rejects.toThrow('fetch aborted')
    expect(fetchUrlsUnprocessedMock).not.toHaveBeenCalled()
  })

  it('propagates upstream fetch failures', async () => {
    fetchUrlsUnprocessedMock.mockRejectedValue(new Error('Jina Reader fetch failed: HTTP 500'))

    await expect(fetchKnowledgeWebPage('https://example.com')).rejects.toThrow('Jina Reader fetch failed: HTTP 500')
  })

  it('rejects unsupported protocols before dispatching the request', async () => {
    await expect(fetchKnowledgeWebPage('file:///etc/passwd')).rejects.toThrow(
      'Invalid knowledge url: file:///etc/passwd'
    )

    expect(fetchUrlsUnprocessedMock).not.toHaveBeenCalled()
  })

  it('limits concurrent upstream web fetches through a shared queue', async () => {
    let activeFetches = 0
    let maxActiveFetches = 0
    const deferredResponses = Array.from({ length: 5 }, () => createDeferred<ReturnType<typeof fetchResponse>>())
    let fetchCallIndex = 0

    fetchUrlsUnprocessedMock.mockImplementation(async () => {
      const deferred = deferredResponses[fetchCallIndex]
      fetchCallIndex += 1
      if (!deferred) {
        throw new Error('Unexpected fetch call')
      }

      activeFetches += 1
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches)

      try {
        return await deferred.promise
      } finally {
        activeFetches -= 1
      }
    })

    const requests = [
      fetchKnowledgeWebPage('https://example.com/1'),
      fetchKnowledgeWebPage('https://example.com/2'),
      fetchKnowledgeWebPage('https://example.com/3'),
      fetchKnowledgeWebPage('https://example.com/4'),
      fetchKnowledgeWebPage('https://example.com/5')
    ]

    await vi.waitFor(() => {
      expect(fetchUrlsUnprocessedMock).toHaveBeenCalledTimes(3)
      expect(activeFetches).toBe(3)
    })

    deferredResponses[0].resolve(fetchResponse('https://example.com/1', 'page 1'))

    await vi.waitFor(() => {
      expect(fetchUrlsUnprocessedMock).toHaveBeenCalledTimes(4)
      expect(maxActiveFetches).toBeLessThanOrEqual(3)
    })

    deferredResponses[1].resolve(fetchResponse('https://example.com/2', 'page 2'))
    deferredResponses[2].resolve(fetchResponse('https://example.com/3', 'page 3'))
    deferredResponses[3].resolve(fetchResponse('https://example.com/4', 'page 4'))
    deferredResponses[4].resolve(fetchResponse('https://example.com/5', 'page 5'))

    await expect(Promise.all(requests)).resolves.toEqual([
      fetchedPage('https://example.com/1', 'page 1'),
      fetchedPage('https://example.com/2', 'page 2'),
      fetchedPage('https://example.com/3', 'page 3'),
      fetchedPage('https://example.com/4', 'page 4'),
      fetchedPage('https://example.com/5', 'page 5')
    ])
    expect(maxActiveFetches).toBeLessThanOrEqual(3)
  })

  it('does not create the fetch timeout while a request is waiting in the queue', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const deferredResponses = Array.from({ length: 4 }, () => createDeferred<ReturnType<typeof fetchResponse>>())
    let fetchCallIndex = 0

    fetchUrlsUnprocessedMock.mockImplementation(async () => {
      const deferred = deferredResponses[fetchCallIndex]
      fetchCallIndex += 1
      if (!deferred) {
        throw new Error('Unexpected fetch call')
      }

      return await deferred.promise
    })

    const queuedController = new AbortController()
    const activeRequests = [
      fetchKnowledgeWebPage('https://example.com/1'),
      fetchKnowledgeWebPage('https://example.com/2'),
      fetchKnowledgeWebPage('https://example.com/3')
    ]
    const queuedRequest = fetchKnowledgeWebPage('https://example.com/4', queuedController.signal)
    void queuedRequest.catch(() => undefined)

    await vi.waitFor(() => {
      expect(fetchUrlsUnprocessedMock).toHaveBeenCalledTimes(3)
    })

    expect(timeoutSpy).toHaveBeenCalledTimes(3)
    expect(fetchUrlsUnprocessedMock).toHaveBeenCalledTimes(3)

    queuedController.abort(new Error('queued abort'))
    deferredResponses[0].resolve(fetchResponse('https://example.com/1', 'page 1'))
    deferredResponses[1].resolve(fetchResponse('https://example.com/2', 'page 2'))
    deferredResponses[2].resolve(fetchResponse('https://example.com/3', 'page 3'))

    await expect(Promise.all(activeRequests)).resolves.toEqual([
      fetchedPage('https://example.com/1', 'page 1'),
      fetchedPage('https://example.com/2', 'page 2'),
      fetchedPage('https://example.com/3', 'page 3')
    ])
    expect(fetchUrlsUnprocessedMock).toHaveBeenCalledTimes(3)
    timeoutSpy.mockRestore()
  })
})
