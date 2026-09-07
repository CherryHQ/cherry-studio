import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TextGenerationRequestService } from '../TextGenerationRequestService'

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('TextGenerationRequestService', () => {
  beforeEach(() => BaseService.resetInstances())

  it('passes a live signal to the registered operation', async () => {
    const service = new TextGenerationRequestService()
    const operation = vi.fn(async (signal: AbortSignal) => signal.aborted)

    await expect(service.run('request-1', operation)).resolves.toBe(false)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('settles on abort even when the operation ignores the signal', async () => {
    const service = new TextGenerationRequestService()
    const started = deferred<AbortSignal>()
    const run = service.run('request-1', async (signal) => {
      started.resolve(signal)
      return new Promise<never>(() => undefined)
    })

    const signal = await started.promise
    service.abort('request-1')

    expect(signal.aborted).toBe(true)
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    await expect(service.run('request-1', async () => 'retry')).resolves.toBe('retry')
  })

  it('treats an unknown abort as a no-op', () => {
    const service = new TextGenerationRequestService()
    expect(() => service.abort('missing')).not.toThrow()
  })

  it('cleans a completed request id so it can be reused', async () => {
    const service = new TextGenerationRequestService()

    await service.run('request-1', async () => undefined)
    await expect(service.run('request-1', async () => 'second')).resolves.toBe('second')
  })

  it('rejects duplicate live request ids without replacing the original controller', async () => {
    const service = new TextGenerationRequestService()
    const started = deferred<AbortSignal>()
    const finished = deferred<void>()
    const first = service.run('request-1', async (signal) => {
      started.resolve(signal)
      await finished.promise
    })

    const originalSignal = await started.promise
    await expect(service.run('request-1', async () => undefined)).rejects.toThrow('Request already in flight')

    service.abort('request-1')
    expect(originalSignal.aborted).toBe(true)
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    finished.resolve()
  })
})
