import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTokenFluxTransport } from '../tokenflux/tokenfluxTransport'

/**
 * Ported from the legacy `providers/tokenflux/__tests__/TokenFluxService.test.ts`
 * plus coverage for the relocated submit body shape and status mapping.
 */
describe('TokenFluxTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stops polling when the request is aborted', async () => {
    const transport = createTokenFluxTransport({ apiKey: 'token' })
    const controller = new AbortController()
    const getGenerationResultSpy = vi
      .spyOn(transport, 'getGenerationResult')
      .mockResolvedValue({ id: 'gen-1', status: 'processing', images: [] })

    const pollingPromise = transport.pollGenerationResult('gen-1', {
      signal: controller.signal,
      intervalMs: 2000
    })

    await Promise.resolve()
    controller.abort()

    await expect(pollingPromise).rejects.toMatchObject({ name: 'AbortError', message: 'Image generation aborted' })

    await vi.advanceTimersByTimeAsync(5000)
    expect(getGenerationResultSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects on the failed status', async () => {
    const transport = createTokenFluxTransport({ apiKey: 'token' })
    vi.spyOn(transport, 'getGenerationResult').mockResolvedValue({ id: 'gen-1', status: 'failed', images: [] })

    await expect(transport.pollGenerationResult('gen-1', { intervalMs: 2000 })).rejects.toThrow(
      'Image generation failed'
    )
  })

  it('submit posts { model, input: { prompt, ...inputParams } } and returns the generation id', async () => {
    const transport = createTokenFluxTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: true, data: { id: 'gen-9' } }), { status: 200 }))

    const result = await transport.submit({
      modelId: 'flux-pro',
      prompt: 'a dog',
      n: 1,
      size: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerParams: { model: 'flux-pro', inputParams: { steps: 30 } }
    })

    expect(result).toEqual({ taskId: 'gen-9' })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ model: 'flux-pro', input: { prompt: 'a dog', steps: 30 } })
  })

  it('forwards the abort signal to the submit fetch (R4)', async () => {
    vi.useRealTimers()
    const transport = createTokenFluxTransport({ apiKey: 'token' })
    const controller = new AbortController()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        ;(init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })
    })

    const promise = transport.submit({
      modelId: 'flux-pro',
      prompt: 'a dog',
      n: 1,
      size: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerParams: { model: 'flux-pro', inputParams: {} },
      signal: controller.signal
    })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })
})
