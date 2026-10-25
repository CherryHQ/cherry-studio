import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiErrorFactory } from '@shared/data/api/errors'

const configMock = vi.hoisted(() => ({
  isDev: true
}))

vi.mock('@renderer/utils/platform', () => ({
  get isDev() {
    return configMock.isDev
  }
}))
vi.unmock('@data/DataApiService')

const request = vi.fn()

beforeEach(() => {
  vi.resetModules()
  request.mockReset()
  configMock.isDev = true

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      dataApi: {
        request
      }
    }
  })
})

afterEach(async () => {
  const { dataApiDevtoolsTesting } = await import('../utils/dataApiDevtools')
  dataApiDevtoolsTesting.reset()
  vi.restoreAllMocks()
})

async function createService(options: { capturePayloads?: boolean } = {}) {
  // The control surface is exposed by the window bootstrap (prepareWindow),
  // not by the DataApiService constructor — mirror that ordering here.
  const { DataApiDevtools } = await import('../utils/dataApiDevtools')
  DataApiDevtools.exposeControlSurface()
  const { DataApiService } = await import('../DataApiService')
  const service = new DataApiService()
  if (options.capturePayloads) {
    window.__CHERRY_DATA_API_DEVTOOLS__?.setOptions({ capturePayloads: true })
  }
  return service
}

describe('DataApiService devtools instrumentation', () => {
  it('records a successful request with truncated request and response previews', async () => {
    const service = await createService({ capturePayloads: true })
    expect(window.__CHERRY_DATA_API_DEVTOOLS__).toBeDefined()
    request.mockImplementationOnce(async (req) => ({
      id: req.id,
      status: 200,
      data: {
        ok: true,
        token: 'response-token'
      },
      metadata: {
        timestamp: Date.now(),
        duration: 7,
        handlerDuration: 5
      }
    }))

    const result = await service.post('/providers' as any, {
      query: { authorization: 'Bearer secret' } as any,
      body: {
        apiKey: 'request-key',
        cookie: 'session-cookie',
        nested: { token: 'nested-token' },
        privateKey: 'private-key',
        sessionId: 'session-id',
        longText: 'x'.repeat(1005)
      } as any
    })

    expect(result).toEqual({ ok: true, token: 'response-token' })
    const events = window.__CHERRY_DATA_API_DEVTOOLS__?.snapshot() ?? []
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      state: 'success',
      method: 'POST',
      path: '/providers',
      query: { authorization: 'Bearer secret' },
      body: {
        apiKey: 'request-key',
        cookie: 'session-cookie',
        nested: { token: 'nested-token' },
        privateKey: 'private-key',
        sessionId: 'session-id'
      },
      status: 200,
      response: { ok: true, token: 'response-token' },
      mainDuration: 7,
      handlerDuration: 5
    })
    expect(JSON.stringify(events[0].body)).toContain('<truncated 5 chars>')
    expect(events[0].clientDuration).toEqual(expect.any(Number))
  })

  it('does not let devtools payload inspection block the request', async () => {
    const service = await createService({ capturePayloads: true })
    request.mockImplementationOnce(async (req) => ({
      id: req.id,
      status: 200,
      data: { ok: true },
      metadata: { timestamp: Date.now() }
    }))

    await expect(
      service.post('/providers' as any, {
        body: {
          get value() {
            throw new Error('payload getter failed')
          }
        } as any
      })
    ).resolves.toEqual({ ok: true })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('records failed requests with request and error details in one entry', async () => {
    const service = await createService({ capturePayloads: true })
    const error = DataApiErrorFactory.validation({ name: ['Required'] }, 'Invalid provider')
    request.mockImplementationOnce(async (req) => ({
      id: req.id,
      status: error.status,
      error: error.toJSON(),
      metadata: {
        timestamp: Date.now(),
        duration: 9,
        handlerDuration: 6
      }
    }))

    await expect(service.get('/providers' as any)).rejects.toThrow('Invalid provider')

    const events = window.__CHERRY_DATA_API_DEVTOOLS__?.snapshot() ?? []
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      state: 'error',
      status: 422,
      method: 'GET',
      path: '/providers',
      mainDuration: 9,
      handlerDuration: 6,
      error: {
        name: 'DataApiError',
        code: 'VALIDATION_ERROR',
        message: 'Invalid provider',
        isRetryable: false
      }
    })
  })

  it('omits error messages when payload capture is disabled', async () => {
    const service = await createService()

    const error = DataApiErrorFactory.validation({ name: ['Required'] }, 'Invalid provider token=secret')
    request.mockImplementationOnce(async (req) => ({
      id: req.id,
      status: error.status,
      error: error.toJSON(),
      metadata: {
        timestamp: Date.now(),
        duration: 9,
        handlerDuration: 6
      }
    }))

    await expect(service.get('/providers' as any)).rejects.toThrow('Invalid provider token=secret')

    const events = window.__CHERRY_DATA_API_DEVTOOLS__?.snapshot() ?? []
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      state: 'error',
      error: {
        name: 'DataApiError',
        code: 'VALIDATION_ERROR',
        message: '<payload capture disabled>',
        isRetryable: false
      }
    })
  })

  it('records retry attempts and keeps retry request ids correlated', async () => {
    const service = await createService({ capturePayloads: true })
    const retryableError = DataApiErrorFactory.timeout('/providers', 3000)
    request
      .mockImplementationOnce(async (req) => ({
        id: req.id,
        status: retryableError.status,
        error: retryableError.toJSON(),
        metadata: { timestamp: Date.now() }
      }))
      .mockImplementationOnce(async (req) => ({
        id: req.id,
        status: 200,
        data: { ok: true },
        metadata: { timestamp: Date.now() }
      }))

    service.configureRetry({ maxRetries: 1, retryDelay: 0 })

    await expect(service.get('/providers' as any)).resolves.toEqual({ ok: true })

    const events = window.__CHERRY_DATA_API_DEVTOOLS__?.snapshot() ?? []
    expect(events.map((event) => event.state)).toEqual(['retry', 'success'])
    expect(events[0]).toMatchObject({
      state: 'retry',
      retryAttempt: 1,
      error: {
        code: 'TIMEOUT',
        isRetryable: true
      }
    })
    expect(events[1].requestId).not.toBe(events[0].requestId)
    expect(events[1]).toMatchObject({
      state: 'success',
      retryAttempt: 1,
      response: { ok: true }
    })
  })

  it('does not install or record devtools events outside development', async () => {
    configMock.isDev = false
    request.mockImplementationOnce(async (req) => ({
      id: req.id,
      status: 200,
      data: { ok: true },
      metadata: { timestamp: Date.now() }
    }))

    const service = await createService()

    await expect(service.get('/providers' as any)).resolves.toEqual({ ok: true })
    expect(window.__CHERRY_DATA_API_DEVTOOLS__).toBeUndefined()
  })
})

describe('transcript read deadlines', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([{ cursor: 'older-page' }, { messageId: 'message-1' }, {}])(
    'keeps the original transcript IPC response past every old retry deadline: %j',
    async (query) => {
      const service = await createService()
      vi.useFakeTimers()
      let resolve!: (response: unknown) => void
      request.mockImplementationOnce(() => new Promise((done) => (resolve = done)))
      const payload = { items: [{ id: 'message-1', content: 'retained' }], nextCursor: 'next-page' }
      let settled = false
      const pending = service.get('/agent-sessions/session-1/messages', { query })
      void pending.then(() => (settled = true))
      let elapsed = 0
      for (const time of [3000, 4000, 7000, 9000, 12000]) {
        await vi.advanceTimersByTimeAsync(time - elapsed)
        elapsed = time
        expect(settled).toBe(false)
        expect(request).toHaveBeenCalledTimes(1)
      }
      resolve({ status: 200, data: payload })
      await expect(pending).resolves.toBe(payload)
      expect(request.mock.calls[0][0]).toMatchObject({ params: query })
      expect(window.__CHERRY_DATA_API_DEVTOOLS__?.snapshot().map((event) => event.state)).toEqual(['success'])
    }
  )

  it.each([
    ['GET', '/agent-sessions/session-1'],
    ['GET', '/agent-sessions/session-1/messages/message-1'],
    ['GET', '/topics/topic-1/messages'],
    ['GET', '/temporary/topics/topic-1/messages'],
    ['GET', '/providers'],
    ['POST', '/agent-sessions/session-1/messages'],
    ['GET', '/agent-sessions/session-1/messages?cursor=x'],
    ['GET', '/agent-sessions/session-1/messages#anchor'],
    ['GET', '/agent-sessions//messages']
  ])('retains the 3 s deadline for %s %s', async (method, path) => {
    const service = await createService()
    service.configureRetry({ maxRetries: 0 })
    vi.useFakeTimers()
    request.mockImplementation(() => new Promise(() => {}))
    let settled = false
    const pending = method === 'GET' ? service.get(path as any) : service.post(path as any, {})
    const outcome = pending.catch((error) => {
      settled = true
      return error
    })
    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toMatchObject({ code: 'TIMEOUT' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('retains default timeout retries at 4 s and 9 s with final failure at 12 s', async () => {
    const service = await createService()
    vi.useFakeTimers()
    request.mockImplementation(() => new Promise(() => {}))
    let settled = false
    const outcome = service.get('/agent-sessions/session-1').catch((error) => {
      settled = true
      return error
    })
    let elapsed = 0
    for (const [time, calls] of [
      [3000, 1],
      [4000, 2],
      [7000, 2],
      [9000, 3],
      [11999, 3]
    ]) {
      await vi.advanceTimersByTimeAsync(time - elapsed)
      elapsed = time
      expect(settled).toBe(false)
      expect(request).toHaveBeenCalledTimes(calls)
    }
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toMatchObject({ code: 'TIMEOUT' })
    expect(window.__CHERRY_DATA_API_DEVTOOLS__?.snapshot().map((event) => event.state)).toEqual([
      'retry',
      'retry',
      'error'
    ])
  })

  it('returns prompt transcript data unchanged', async () => {
    const service = await createService()
    const data = { items: [], nextCursor: null }
    request.mockResolvedValueOnce({ status: 200, data })
    await expect(service.get('/agent-sessions/session-1/messages')).resolves.toBe(data)
  })

  it('reconstructs a non-retryable serialized transcript error', async () => {
    const service = await createService()
    const error = DataApiErrorFactory.validation({}, 'Invalid transcript cursor')
    request.mockResolvedValueOnce({ status: error.status, error: error.toJSON() })
    await expect(service.get('/agent-sessions/session-1/messages')).rejects.toMatchObject({
      code: error.code,
      message: 'Invalid transcript cursor'
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['serialized', 'rejected'])('retries a real %s transcript failure', async (kind) => {
    const service = await createService()
    vi.useFakeTimers()
    const error = DataApiErrorFactory.timeout('/agent-sessions/session-1/messages', 3000)
    if (kind === 'serialized') request.mockResolvedValueOnce({ status: error.status, error: error.toJSON() })
    else request.mockRejectedValueOnce(error)
    const data = { items: [{ id: 'recovered' }], nextCursor: null }
    request.mockResolvedValueOnce({ status: 200, data })
    const pending = service.get('/agent-sessions/session-1/messages')
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toBe(data)
    expect(request).toHaveBeenCalledTimes(2)
    expect(window.__CHERRY_DATA_API_DEVTOOLS__?.snapshot().map((event) => event.state)).toEqual(['retry', 'success'])
  })
})
