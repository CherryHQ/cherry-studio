import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as HealthCheckUtils from '../../utils/healthCheck'
import { aggregateApiKeyResults } from '../../utils/healthCheck'
import { checkModelsHealth } from '../checkModelsHealth'

const checkApiMock = vi.fn()

vi.mock('@renderer/services/ApiService', () => ({
  checkApi: (...args: unknown[]) => checkApiMock(...args)
}))

vi.mock('../../utils/healthCheck', async () => {
  const actual = await vi.importActual<typeof HealthCheckUtils>('../../utils/healthCheck')
  return {
    ...actual,
    aggregateApiKeyResults: vi.fn(actual.aggregateApiKeyResults)
  }
})

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// checkApi resolves to `{ latency }`; tests gate on the underlying call count
// + per-iteration deferreds, so most use a default latency of 0.
const okResult = { latency: 0 }

describe('checkModelsHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not start the next model check until the current one finishes when concurrency is disabled', async () => {
    const first = deferred<typeof okResult>()
    const second = deferred<typeof okResult>()
    checkApiMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const run = checkModelsHealth({
      models: [{ id: 'model-a' }, { id: 'model-b' }] as never,
      apiKeys: ['sk-test'],
      isConcurrent: false,
      timeout: 1000
    })

    await waitFor(() => expect(checkApiMock).toHaveBeenCalledTimes(1))

    first.resolve(okResult)
    await waitFor(() => expect(checkApiMock).toHaveBeenCalledTimes(2))

    second.resolve(okResult)
    await run
  })

  it('rejects when the health check pipeline fails outside per-key results', async () => {
    checkApiMock.mockResolvedValue(okResult)
    vi.mocked(aggregateApiKeyResults).mockImplementationOnce(() => {
      throw new Error('aggregation failed')
    })

    await expect(
      checkModelsHealth({
        models: [{ id: 'model-a' }] as never,
        apiKeys: ['sk-test'],
        isConcurrent: true,
        timeout: 1000
      })
    ).rejects.toThrow('aggregation failed')
  })

  it('aborts between sequential models when the signal fires mid-iteration', async () => {
    // Pin the three signal?.throwIfAborted() guards in sequential mode.
    // After model-a resolves, aborting the controller must drop model-b
    // before any work happens — not finish all then abort.
    const firstResolved = deferred()
    const controller = new AbortController()
    checkApiMock.mockImplementation(async () => {
      firstResolved.resolve()
      return okResult
    })

    const run = checkModelsHealth({
      models: [{ id: 'model-a' }, { id: 'model-b' }] as never,
      apiKeys: ['sk-test'],
      isConcurrent: false,
      timeout: 1000,
      signal: controller.signal
    })

    await firstResolved.promise
    controller.abort()

    await expect(run).rejects.toThrow()
    expect(checkApiMock).toHaveBeenCalledTimes(1)
  })

  it('concurrent mode preserves index-correct slot assignment under partial abort', async () => {
    // In concurrent mode results[index] is assigned (not push), so even if
    // some models reject via abort the surviving result lands at its own index.
    const slowB = deferred<typeof okResult>()
    // checkApi is now called with (uniqueModelId, options) — read the id from
    // the first arg to decide which call should hang.
    checkApiMock.mockImplementation(async (uniqueModelId: string) => {
      if (uniqueModelId === 'model-a') {
        return okResult
      }
      return slowB.promise
    })

    const controller = new AbortController()
    const run = checkModelsHealth({
      models: [{ id: 'model-a' }, { id: 'model-b' }] as never,
      apiKeys: ['sk-test'],
      isConcurrent: true,
      timeout: 1000,
      signal: controller.signal
    })

    // Let model-a complete its slot, then abort before model-b finishes.
    await waitFor(() => expect(checkApiMock).toHaveBeenCalledTimes(2))
    controller.abort()
    slowB.resolve(okResult)

    await expect(run).rejects.toThrow()
  })
})
