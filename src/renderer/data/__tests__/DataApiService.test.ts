import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { DataApiChangeBatch, DataApiChangeCallback, DataApiChangeEnvelope } from '@shared/data/api/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const onChanged = vi.fn()
const stopChanges = vi.fn()
let emitChanges: DataApiChangeCallback<DataApiChangeEnvelope> | undefined

beforeEach(() => {
  vi.resetModules()
  request.mockReset()
  onChanged.mockReset()
  stopChanges.mockReset()
  emitChanges = undefined
  onChanged.mockImplementation((callback: DataApiChangeCallback<DataApiChangeEnvelope>) => {
    emitChanges = callback
    return stopChanges
  })
  configMock.isDev = true

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      dataApi: {
        request,
        onChanged
      }
    }
  })
})

afterEach(async () => {
  const { dataApiDevtoolsTesting } = await import('../utils/dataApiDevtools')
  dataApiDevtoolsTesting.reset()
  vi.restoreAllMocks()
})

async function createService() {
  const { DataApiService } = await import('../DataApiService')
  return new DataApiService()
}

describe('DataApiService devtools instrumentation', () => {
  it('records a successful request with truncated request and response previews', async () => {
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
    request.mockImplementationOnce(async (req) => ({
      id: req.id,
      status: 200,
      data: { ok: true },
      metadata: { timestamp: Date.now() }
    }))

    const service = await createService()

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

  it('omits error messages when payload capture is disabled', async () => {
    const { DataApiDevtools } = await import('../utils/dataApiDevtools')
    DataApiDevtools.recordStart({
      requestId: 'setup',
      method: 'GET',
      path: '/setup',
      retryAttempt: 0
    })
    window.__CHERRY_DATA_API_DEVTOOLS__?.clear()
    window.__CHERRY_DATA_API_DEVTOOLS__?.setOptions({ capturePayloads: false })

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

    const service = await createService()

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

describe('DataApiService change subscriptions', () => {
  type ProjectionChange = DataApiChangeEnvelope<'test.projection', { id: string }>
  type MembershipChange = DataApiChangeEnvelope<'test.membership', { ids: string[] }>
  type TestChange = ProjectionChange | MembershipChange
  type TestChangeCallback<TChange extends DataApiChangeEnvelope> = (batch: { changes: readonly TChange[] }) => void
  type TestSubscribeChanges = <TChange extends DataApiChangeEnvelope>(
    types: readonly TChange['type'][],
    callback: TestChangeCallback<TChange>
  ) => () => void

  it('shares one preload listener and filters each committed batch by change type', async () => {
    const service = await createService()
    const subscribeChanges = service.subscribeChanges as unknown as TestSubscribeChanges
    const onProjection = vi.fn<TestChangeCallback<ProjectionChange>>()
    const onMembership = vi.fn<TestChangeCallback<MembershipChange>>()

    const unsubscribeProjection = subscribeChanges<ProjectionChange>(['test.projection'], onProjection)
    const unsubscribeMembership = subscribeChanges<MembershipChange>(['test.membership'], onMembership)

    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(service.getRequestStats().activeSubscriptions).toBe(2)

    const batch: DataApiChangeBatch<TestChange> = {
      changes: [
        { type: 'test.projection', payload: { id: 'item-1' } },
        { type: 'test.membership', payload: { ids: ['item-1'] } },
        { type: 'test.projection', payload: { id: 'item-2' } }
      ]
    }
    emitChanges?.(batch)

    expect(onProjection).toHaveBeenCalledTimes(1)
    expect(onProjection).toHaveBeenCalledWith({ changes: [batch.changes[0], batch.changes[2]] })
    expect(onMembership).toHaveBeenCalledTimes(1)
    expect(onMembership).toHaveBeenCalledWith({ changes: [batch.changes[1]] })

    unsubscribeProjection()
    expect(stopChanges).not.toHaveBeenCalled()
    expect(service.getRequestStats().activeSubscriptions).toBe(1)

    unsubscribeMembership()
    expect(stopChanges).toHaveBeenCalledTimes(1)
    expect(service.getRequestStats().activeSubscriptions).toBe(0)
  })

  it('does not notify a subscription when the batch has no selected change type', async () => {
    const service = await createService()
    const subscribeChanges = service.subscribeChanges as unknown as TestSubscribeChanges
    const onProjection = vi.fn<TestChangeCallback<ProjectionChange>>()

    const unsubscribe = subscribeChanges<ProjectionChange>(['test.projection'], onProjection)

    const batch: DataApiChangeBatch<MembershipChange> = {
      changes: [{ type: 'test.membership', payload: { ids: ['item-1'] } }]
    }
    emitChanges?.(batch)

    expect(onProjection).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('continues dispatching when one subscription callback throws', async () => {
    const service = await createService()
    const subscribeChanges = service.subscribeChanges as unknown as TestSubscribeChanges
    const failingSubscriber = vi.fn<TestChangeCallback<ProjectionChange>>(() => {
      throw new Error('subscriber failed')
    })
    const followingSubscriber = vi.fn<TestChangeCallback<ProjectionChange>>()

    const unsubscribeFailing = subscribeChanges<ProjectionChange>(['test.projection'], failingSubscriber)
    const unsubscribeFollowing = subscribeChanges<ProjectionChange>(['test.projection'], followingSubscriber)
    const batch: DataApiChangeBatch<ProjectionChange> = {
      changes: [{ type: 'test.projection', payload: { id: 'item-1' } }]
    }

    emitChanges?.(batch)

    expect(failingSubscriber).toHaveBeenCalledWith(batch)
    expect(followingSubscriber).toHaveBeenCalledWith(batch)
    unsubscribeFailing()
    unsubscribeFollowing()
  })
})
