import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { DataRequest, DataResponse } from '@shared/data/api/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@data/DataApiService')

const request = vi.fn<(request: DataRequest) => Promise<DataResponse>>()

beforeEach(() => {
  vi.useFakeTimers()
  request.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { dataApi: { request } }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

async function createService() {
  const { DataApiService } = await import('../DataApiService')
  return new DataApiService()
}

function delayedResponse(delay: number, data: unknown) {
  request.mockImplementation(
    (req) => new Promise((resolve) => setTimeout(() => resolve({ id: req.id, status: 200, data }), delay))
  )
}

describe('DataApiService local read timeouts', () => {
  it.each(['/topics', '/topics/topic-1', '/topics/topic-1/messages'] as const)(
    'recovers a delayed %s response without discarding it at three seconds',
    async (path) => {
      const service = await createService()
      const data = { items: [{ id: 'first' }, { id: 'second' }] }
      delayedResponse(3500, data)

      const result = expect(service.get(path)).resolves.toEqual(data)
      await vi.advanceTimersByTimeAsync(12000)
      await result
      expect(request).toHaveBeenCalledTimes(1)
    }
  )

  it('does not start another IPC read while a slow response is still pending', async () => {
    const service = await createService()
    delayedResponse(5000, { id: 'topic-1' })

    const result = expect(service.get('/topics/topic-1')).resolves.toEqual({ id: 'topic-1' })
    await vi.advanceTimersByTimeAsync(4500)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(7500)
    await result
  })

  it('rejects a persistently stalled read within the existing total retry budget', async () => {
    const service = await createService()
    request.mockImplementation(() => new Promise(() => {}))
    const result = expect(service.get('/topics')).rejects.toMatchObject({ code: 'TIMEOUT' })

    await vi.advanceTimersByTimeAsync(12000)
    await result
    expect(request).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('still retries a completed retryable error response', async () => {
    const service = await createService()
    const error = DataApiErrorFactory.timeout('/topics', 3000)
    request
      .mockImplementationOnce(async (req) => ({ id: req.id, status: error.status, error: error.toJSON() }))
      .mockImplementationOnce(async (req) => ({ id: req.id, status: 200, data: { items: [] } }))

    const result = expect(service.get('/topics')).resolves.toEqual({ items: [] })
    await vi.advanceTimersByTimeAsync(1000)
    await result
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('shares the read deadline with retries of completed error responses', async () => {
    const service = await createService()
    const error = DataApiErrorFactory.timeout('/topics', 3000)
    request
      .mockImplementationOnce(
        (req) =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ id: req.id, status: error.status, error: error.toJSON() }), 10500)
          )
      )
      .mockImplementation(() => new Promise(() => {}))

    const result = expect(service.get('/topics')).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(12000)
    await result
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('honors disabled retries with the original three-second read budget', async () => {
    const service = await createService()
    service.configureRetry({ maxRetries: 0 })
    request.mockImplementation(() => new Promise(() => {}))

    const result = expect(service.get('/topics')).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(3000)
    await result
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('returns a deleted topic error without retrying', async () => {
    const service = await createService()
    const error = DataApiErrorFactory.notFound('Topic', 'deleted')
    request.mockImplementation(async (req) => ({ id: req.id, status: error.status, error: error.toJSON() }))

    await expect(service.get('/topics/deleted')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['GET', 'POST'] as const)(
    'preserves fast %s requests and clears completed timeout timers',
    async (method) => {
      const service = await createService()
      delayedResponse(100, { id: 'created-topic' })

      const response =
        method === 'GET' ? service.get('/topics') : service.post('/topics', { body: { name: 'New topic' } })
      const result = expect(response).resolves.toEqual({
        id: 'created-topic'
      })
      await vi.advanceTimersByTimeAsync(100)
      await result
      expect(request).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    }
  )
})
