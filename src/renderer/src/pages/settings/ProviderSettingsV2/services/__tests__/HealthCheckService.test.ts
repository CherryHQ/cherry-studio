import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { checkModelsHealth } from '../HealthCheckService'

const checkModelMock = vi.fn()

vi.mock('@renderer/services/ApiService', () => ({
  checkModel: (...args: unknown[]) => checkModelMock(...args)
}))

vi.mock('../../utils/v1ProviderShim', () => ({
  toV1ModelForCheckApi: (model: unknown) => model,
  toV1ProviderShim: (provider: unknown) => provider
}))

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
})
