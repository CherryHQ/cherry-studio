import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

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

const { fetchKnowledgeWebPage } = await import('../url')

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
    fetchMock.mockReset()
  })

  it('fetches a page and returns markdown content', async () => {
    fetchMock.mockResolvedValue(new Response('# Example Page\n\nHello knowledge', { status: 200 }))

    const controller = new AbortController()

    await expect(fetchKnowledgeWebPage('https://example.com', controller.signal)).resolves.toBe(
      '# Example Page\n\nHello knowledge'
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: {
          'X-Retain-Images': 'none',
          'X-Return-Format': 'markdown'
        }
      })
    )
  })

  it('rejects before execution when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('fetch aborted'))

    await expect(fetchKnowledgeWebPage('https://example.com', controller.signal)).rejects.toThrow('fetch aborted')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on non-ok upstream responses', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))

    await expect(fetchKnowledgeWebPage('https://example.com')).rejects.toThrow(
      'Failed to fetch knowledge web page https://example.com: HTTP 500'
    )
  })

  it('rejects unsupported protocols before dispatching the request', async () => {
    await expect(fetchKnowledgeWebPage('file:///etc/passwd')).rejects.toThrow(
      'Invalid knowledge url: file:///etc/passwd'
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('limits concurrent upstream web fetches through a shared queue', async () => {
    let activeFetches = 0
    let maxActiveFetches = 0
    const deferredResponses = Array.from({ length: 5 }, () => createDeferred<Response>())
    let fetchCallIndex = 0

    fetchMock.mockImplementation(async () => {
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
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(activeFetches).toBe(3)
    })

    deferredResponses[0].resolve(new Response('page 1', { status: 200 }))

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(maxActiveFetches).toBeLessThanOrEqual(3)
    })

    deferredResponses[1].resolve(new Response('page 2', { status: 200 }))
    deferredResponses[2].resolve(new Response('page 3', { status: 200 }))
    deferredResponses[3].resolve(new Response('page 4', { status: 200 }))
    deferredResponses[4].resolve(new Response('page 5', { status: 200 }))

    await expect(Promise.all(requests)).resolves.toEqual(['page 1', 'page 2', 'page 3', 'page 4', 'page 5'])
    expect(maxActiveFetches).toBeLessThanOrEqual(3)
  })
})
