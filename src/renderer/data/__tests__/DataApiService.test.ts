import { DataApiErrorFactory } from '@shared/data/api/apiErrors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const configMock = vi.hoisted(() => ({
  isDev: true
}))

vi.mock('@renderer/config/constant', () => ({
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
  const { dataApiDevtoolsTesting } = await import('../dataApiDevtools')
  dataApiDevtoolsTesting.reset()
  vi.restoreAllMocks()
})

async function createService() {
  const { DataApiService } = await import('../DataApiService')
  return new DataApiService()
}

describe('DataApiService devtools instrumentation', () => {
  it('records a successful request with sanitized request and response previews', async () => {
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

    const service = await createService()
    const result = await service.post('/providers' as any, {
      query: { authorization: 'Bearer secret' } as any,
      body: {
        apiKey: 'request-key',
        nested: { token: 'nested-token' },
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
      query: { authorization: '<redacted>' },
      body: {
        apiKey: '<redacted>',
        nested: { token: '<redacted>' }
      },
      status: 200,
      response: { ok: true, token: '<redacted>' },
      mainDuration: 7,
      handlerDuration: 5
    })
    expect(JSON.stringify(events[0].body)).toContain('<truncated 5 chars>')
    expect(events[0].clientDuration).toEqual(expect.any(Number))
  })

  it('records failed requests with request and error details in one entry', async () => {
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

    const service = await createService()

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

  it('records retry attempts and keeps retry request ids correlated', async () => {
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

    const service = await createService()
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
