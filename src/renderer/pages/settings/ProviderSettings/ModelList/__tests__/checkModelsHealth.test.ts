import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as HealthCheckUtils from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'

import type { ApiKeyWithStatus, ModelCheckCredential } from '../../types/healthCheck'
import { HealthStatus } from '../../types/healthCheck'
import { checkModelsHealth } from '../checkModelsHealth'

const checkModelWithMultipleKeysMock = vi.fn()

vi.mock('../../utils/healthCheck', async () => {
  const actual = await vi.importActual<typeof HealthCheckUtils>('../../utils/healthCheck')
  return {
    ...actual,
    checkModelWithMultipleKeys: (...args: unknown[]) => checkModelWithMultipleKeysMock(...args)
  }
})

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const credentials = [
  { kind: 'api-key', entry: { id: 'key-1', key: 'sk-1', label: 'Primary', isEnabled: true } },
  { kind: 'api-key', entry: { id: 'key-2', key: 'sk-2', label: 'Backup', isEnabled: true } },
  { kind: 'api-key', entry: { id: 'key-3', key: 'sk-3', isEnabled: true } }
] satisfies ModelCheckCredential[]

function okKeyResult(credential: ModelCheckCredential, latency = 0): ApiKeyWithStatus {
  return {
    kind: 'ok',
    credential,
    status: HealthStatus.SUCCESS,
    checking: false,
    latency
  }
}

describe('checkModelsHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkModelWithMultipleKeysMock.mockResolvedValue([okKeyResult(credentials[0])])
  })

  it('does not start the next model check until the current one finishes when concurrency is disabled', async () => {
    const first = deferred<ApiKeyWithStatus[]>()
    const second = deferred<ApiKeyWithStatus[]>()
    checkModelWithMultipleKeysMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const run = checkModelsHealth({
      models: [{ id: 'model-a' }, { id: 'model-b' }] as never,
      credentials: credentials.slice(0, 1),
      isConcurrent: false,
      timeout: 1000
    })

    await waitFor(() => expect(checkModelWithMultipleKeysMock).toHaveBeenCalledTimes(1))

    first.resolve([okKeyResult(credentials[0], 10)])
    await waitFor(() => expect(checkModelWithMultipleKeysMock).toHaveBeenCalledTimes(2))

    second.resolve([okKeyResult(credentials[0], 20)])
    await run
  })

  it('starts every model concurrently and preserves model order when completion order differs', async () => {
    const first = deferred<ApiKeyWithStatus[]>()
    const second = deferred<ApiKeyWithStatus[]>()
    checkModelWithMultipleKeysMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const run = checkModelsHealth({
      models: [{ id: 'model-a' }, { id: 'model-b' }] as never,
      credentials: credentials.slice(0, 1),
      isConcurrent: true,
      timeout: 1000
    })

    await waitFor(() => expect(checkModelWithMultipleKeysMock).toHaveBeenCalledTimes(2))
    second.resolve([okKeyResult(credentials[0], 20)])
    first.resolve([okKeyResult(credentials[0], 10)])
    const results = await run

    expect(results.map((result) => result.model.id)).toEqual(['model-a', 'model-b'])
    expect(results.map((result) => result.latency)).toEqual([10, 20])
  })

  it('aborts between sequential models when the signal fires mid-iteration', async () => {
    const first = deferred<ApiKeyWithStatus[]>()
    const controller = new AbortController()
    checkModelWithMultipleKeysMock.mockReturnValueOnce(first.promise)

    const run = checkModelsHealth({
      models: [{ id: 'model-a' }, { id: 'model-b' }] as never,
      credentials: credentials.slice(0, 1),
      isConcurrent: false,
      timeout: 1000,
      signal: controller.signal
    })

    await waitFor(() => expect(checkModelWithMultipleKeysMock).toHaveBeenCalledTimes(1))
    controller.abort()
    first.resolve([okKeyResult(credentials[0])])

    await expect(run).rejects.toThrow()
    expect(checkModelWithMultipleKeysMock).toHaveBeenCalledTimes(1)
  })
})
