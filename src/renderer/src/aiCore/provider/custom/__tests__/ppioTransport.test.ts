import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPpioTransport, PpioTaskFailedError } from '../pollingTransports/ppio'

/**
 * Ported from the legacy `providers/ppio/__tests__/PpioService.test.ts` plus
 * coverage for the relocated transient-retry cap and param builders.
 */
describe('PpioTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stops polling immediately when the request is aborted', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    const controller = new AbortController()
    const getTaskResultSpy = vi.spyOn(transport, 'getTaskResult').mockResolvedValue({
      task: { task_id: 'task-1', status: 'TASK_STATUS_PROCESSING', task_type: 'image' },
      images: []
    })

    const pollingPromise = transport.pollTaskResult('task-1', { signal: controller.signal })

    await Promise.resolve()
    controller.abort()

    await expect(pollingPromise).rejects.toMatchObject({ name: 'AbortError', message: 'Task polling aborted' })

    await vi.advanceTimersByTimeAsync(15000)
    expect(getTaskResultSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects on TASK_STATUS_FAILED with PpioTaskFailedError (no reason → "Task failed" fallback)', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    vi.spyOn(transport, 'getTaskResult').mockResolvedValue({
      task: { task_id: 'task-1', status: 'TASK_STATUS_FAILED', task_type: 'image' }
    })

    await expect(transport.pollTaskResult('task-1')).rejects.toBeInstanceOf(PpioTaskFailedError)
    await expect(transport.pollTaskResult('task-1')).rejects.toThrow('Task failed')
  })

  it('surfaces vendor reason verbatim instead of silently retrying it as transient', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    const getTaskResultSpy = vi.spyOn(transport, 'getTaskResult').mockResolvedValue({
      task: { task_id: 'task-1', status: 'TASK_STATUS_FAILED', reason: 'Insufficient credits', task_type: 'image' }
    })

    const promise = transport.pollTaskResult('task-1').catch((e) => e)
    const error = await promise

    expect(error).toBeInstanceOf(PpioTaskFailedError)
    expect((error as Error).message).toBe('Insufficient credits')
    // Terminal failure → exactly one call; no transient-retry storm.
    expect(getTaskResultSpy).toHaveBeenCalledTimes(1)
  })

  it('gives up after the transient-retry cap (10)', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    const getTaskResultSpy = vi.spyOn(transport, 'getTaskResult').mockRejectedValue(new Error('network glitch'))

    const promise = transport.pollTaskResult('task-1').catch((e) => e)
    await vi.advanceTimersByTimeAsync(60000)
    const error = await promise

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('network glitch')
    expect(getTaskResultSpy).toHaveBeenCalledTimes(10)
  })

  it('builds jimeng params with width/height from size and seed default', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ task_id: 't-1' }), { status: 200 }))

    await transport.submit({
      prompt: 'a fox',
      n: 1,
      size: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerParams: {
        model: 'jimeng-txt2img-v3.1',
        modelDescriptor: { id: 'jimeng-txt2img-v3.1', endpoint: '/v3/async/jimeng-txt2img-v3.1' },
        size: '1328x1328',
        addWatermark: true
      }
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({
      prompt: 'a fox',
      use_pre_llm: true,
      seed: -1,
      width: 1328,
      height: 1328,
      logo_info: { add_logo: true }
    })
  })

  it('uses the sync path (imageUrls) for isSync models', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ images: ['https://img/a.png'] }), { status: 200 })
    )

    const result = await transport.submit({
      prompt: 'a fox',
      n: 1,
      size: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerParams: {
        model: 'seedream-4.5-draw',
        modelDescriptor: { id: 'seedream-4.5-draw', endpoint: '/v3/seedream-4.5', isSync: true }
      }
    })

    expect(result).toEqual({ imageUrls: ['https://img/a.png'] })
  })
})
