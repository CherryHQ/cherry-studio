import { DEFAULT_TIMEOUT } from '@main/ai/constants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImageGenerationSubmitInput } from '../imageGenerationModel'
import { createPpioTransport, PpioApiError, PpioTaskFailedError } from '../ppio/ppioTransport'

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

  it('retries a transient 5xx poll response up to the cap instead of failing fast', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    const getTaskResultSpy = vi
      .spyOn(transport, 'getTaskResult')
      .mockRejectedValue(new PpioApiError('PPIO API error: 503', 503))

    const promise = transport.pollTaskResult('task-1').catch((e) => e)
    await vi.advanceTimersByTimeAsync(60000)
    const error = await promise

    expect(error).toBeInstanceOf(PpioApiError)
    // 503 is transient → retried to the cap, not thrown on the first hit.
    expect(getTaskResultSpy).toHaveBeenCalledTimes(10)
  })

  it('treats a 4xx poll response as terminal (single call, no retry storm)', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    const getTaskResultSpy = vi
      .spyOn(transport, 'getTaskResult')
      .mockRejectedValue(new PpioApiError('PPIO API error: 400', 400))

    const error = await transport.pollTaskResult('task-1').catch((e) => e)

    expect(error).toBeInstanceOf(PpioApiError)
    expect(getTaskResultSpy).toHaveBeenCalledTimes(1)
  })

  it('builds jimeng params with width/height from size and seed default', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ task_id: 't-1' }), { status: 200 }))

    await transport.submit({
      modelId: 'jimeng-txt2img-v3.1',
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
      modelId: 'seedream-4.5-draw',
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

  it('uses the default request timeout for isSync models', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal
          signal.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )

    const promise = transport
      .submit({
        modelId: 'seedream-4.5-draw',
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
      .catch((error) => error)

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT)

    const error = await promise
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(`PPIO API request timeout after ${DEFAULT_TIMEOUT / 1000}s`)
  })

  it('supports official Seedream 5.0 Lite sync endpoint and object image results', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ images: [{ url: 'https://img/a.png' }, { image_url: 'https://img/b.png' }] }), {
        status: 200
      })
    )

    const result = await transport.submit({
      modelId: 'seedream-5.0-lite',
      prompt: 'a fox',
      n: 1,
      size: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerParams: {
        model: 'seedream-5.0-lite',
        modelDescriptor: {
          id: 'seedream-5.0-lite',
          endpoint: '/v3/seedream-5.0-lite',
          isSync: true,
          mode: 'ppio_draw'
        },
        size: '2K',
        addWatermark: false
      }
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.ppio.com/v3/seedream-5.0-lite')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({
      prompt: 'a fox',
      size: '2K',
      watermark: false,
      sequential_image_generation: 'disabled'
    })
    expect(result).toEqual({ imageUrls: ['https://img/a.png', 'https://img/b.png'] })
  })

  it('uses Seedream 4.0 plural images field for edit requests', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ images: ['https://img/a.png'] }), { status: 200 }))

    await transport.submit({
      modelId: 'seedream-4.0',
      prompt: 'edit it',
      n: 1,
      size: undefined,
      seed: undefined,
      // Attached edit image flows through the canonical `input.files` path
      // (inputImages → options.files), not a providerOptions bag key.
      files: [{ mediaType: 'image/png', data: 'abc' }] as ImageGenerationSubmitInput['files'],
      mask: undefined,
      providerParams: {
        model: 'seedream-4.0',
        modelDescriptor: {
          id: 'seedream-4.0',
          endpoint: '/v3/seedream-4.0',
          isSync: true,
          mode: 'edit'
        },
        size: '2048x2048'
      }
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.images).toEqual(['data:image/png;base64,abc'])
    expect(body.image).toBeUndefined()
  })

  it('builds GLM Image async params with watermark_enabled', async () => {
    const transport = createPpioTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ task_id: 't-glm' }), { status: 200 }))

    const result = await transport.submit({
      modelId: 'glm-image',
      prompt: 'a fox',
      n: 1,
      size: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerParams: {
        model: 'glm-image',
        modelDescriptor: { id: 'glm-image', endpoint: '/v3/async/glm-image', mode: 'ppio_draw' },
        size: '1568x1056',
        addWatermark: false
      }
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.ppio.com/v3/async/glm-image')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({
      prompt: 'a fox',
      size: '1568x1056',
      quality: 'hd',
      watermark_enabled: false
    })
    expect(result).toEqual({ taskId: 't-glm' })
  })
})
