import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TokenFluxService } from '../service'

describe('TokenFluxService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stops polling when the request is aborted', async () => {
    const service = new TokenFluxService('https://api.tokenflux.ai', 'token')
    const controller = new AbortController()
    const getGenerationResultSpy = vi
      .spyOn(service, 'getGenerationResult')
      .mockResolvedValue({ id: 'gen-1', status: 'processing', images: [] })

    const pollingPromise = service.pollGenerationResult('gen-1', {
      signal: controller.signal,
      intervalMs: 2000
    })

    await Promise.resolve()
    controller.abort()

    await expect(pollingPromise).rejects.toMatchObject({ name: 'AbortError', message: 'Image generation aborted' })

    await vi.advanceTimersByTimeAsync(5000)
    expect(getGenerationResultSpy).toHaveBeenCalledTimes(1)
  })
})
