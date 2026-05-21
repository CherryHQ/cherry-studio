import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as HealthCheckUtils from '../../utils/healthCheck'
import { aggregateApiKeyResults } from '../../utils/healthCheck'
import { checkModelsHealth } from '../checkModelsHealth'

const checkModelMock = vi.fn()

vi.mock('@renderer/services/ApiService', () => ({
  checkModel: (...args: unknown[]) => checkModelMock(...args)
}))

vi.mock('../../utils/v1ProviderShim', () => ({
  toV1ModelForCheckApi: (model: unknown) => model,
  toV1ProviderShim: (provider: unknown) => provider
}))

vi.mock('../../utils/healthCheck', async () => {
  const actual = await vi.importActual<typeof HealthCheckUtils>('../../utils/healthCheck')
  return {
    ...actual,
    aggregateApiKeyResults: vi.fn(actual.aggregateApiKeyResults)
  }
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('checkModelsHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not start the next model check until the current one finishes when concurrency is disabled', async () => {
    const first = deferred()
    const second = deferred()
    checkModelMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const run = checkModelsHealth({
      provider: { id: 'openai' } as never,
      models: [{ id: 'model-a' }, { id: 'model-b' }] as never,
      apiKeys: ['sk-test'],
      isConcurrent: false,
      timeout: 1000
    })

    await waitFor(() => expect(checkModelMock).toHaveBeenCalledTimes(1))

    first.resolve()
    await waitFor(() => expect(checkModelMock).toHaveBeenCalledTimes(2))

    second.resolve()
    await run
  })

  it('rejects when the health check pipeline fails outside per-key results', async () => {
    checkModelMock.mockResolvedValue(undefined)
    vi.mocked(aggregateApiKeyResults).mockImplementationOnce(() => {
      throw new Error('aggregation failed')
    })

    await expect(
      checkModelsHealth({
        provider: { id: 'openai' } as never,
        models: [{ id: 'model-a' }] as never,
        apiKeys: ['sk-test'],
        isConcurrent: true,
        timeout: 1000
      })
    ).rejects.toThrow('aggregation failed')
  })

  it('aborts between sequential models when the signal fires mid-iteration', async () => {
    // T5: pin the three signal?.throwIfAborted() guards in sequential mode.
    // After model-a resolves, aborting the controller must drop model-b
    // before any work happens — not finish all then abort.
    const firstResolved = deferred()
    const controller = new AbortController()
    checkModelMock.mockImplementation(async () => {
      firstResolved.resolve()
      return undefined
    })

    const run = checkModelsHealth({
      provider: { id: 'openai' } as never,
      models: [{ id: 'model-a' }, { id: 'model-b' }] as never,
      apiKeys: ['sk-test'],
      isConcurrent: false,
      timeout: 1000,
      signal: controller.signal
    })

    await firstResolved.promise
    controller.abort()

    await expect(run).rejects.toThrow()
    expect(checkModelMock).toHaveBeenCalledTimes(1)
  })

  it('concurrent mode preserves index-correct slot assignment under partial abort', async () => {
    // T5: in concurrent mode results[index] is assigned (not push), so even if
    // some models reject via abort the surviving result lands at its own index.
    const slowB = deferred()
    checkModelMock.mockImplementation(async (_provider, model) => {
      if ((model as { id: string }).id === 'model-a') {
        return undefined
      }
      await slowB.promise
      return undefined
    })

    const controller = new AbortController()
    const run = checkModelsHealth({
      provider: { id: 'openai' } as never,
      models: [{ id: 'model-a' }, { id: 'model-b' }] as never,
      apiKeys: ['sk-test'],
      isConcurrent: true,
      timeout: 1000,
      signal: controller.signal
    })

    // Let model-a complete its slot, then abort before model-b finishes.
    await waitFor(() => expect(checkModelMock).toHaveBeenCalledTimes(2))
    controller.abort()
    slowB.resolve()

    await expect(run).rejects.toThrow()
  })
})
