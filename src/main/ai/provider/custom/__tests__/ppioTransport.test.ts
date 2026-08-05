import { APICallError } from '@ai-sdk/provider'
import { DEFAULT_TIMEOUT } from '@main/ai/constants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImageGenerationSubmitInput } from '../imageGenerationModel'
import type { PpioBag } from '../ppio/ppioTransport'
import { createPpioTransport } from '../ppio/ppioTransport'

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

  it('normalizes one documented task response without owning the poll loop', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          task: { status: 'TASK_STATUS_PROCESSING', progress_percent: 45 }
        }),
        { status: 200 }
      )
    )
    const transport = createPpioTransport({ apiKey: 'token', fetch })
    if (transport.task.kind !== 'supported') throw new Error('expected task transport')

    // Contract source: https://ppio.com/docs/models/reference-get-async-task-result
    // Retrieved 2026-07-27.
    await expect(
      transport.task.query('task-1', {
        signal: new AbortController().signal,
        modelDescriptor: undefined,
        headers: undefined,
        providerParams: {}
      })
    ).resolves.toEqual({ kind: 'pending', progress: 45 })
  })

  it('normalizes a terminal task failure with the vendor reason', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ task: { status: 'TASK_STATUS_FAILED', reason: 'Insufficient credits' } }), {
        status: 200
      })
    )
    const transport = createPpioTransport({ apiKey: 'token', fetch })
    if (transport.task.kind !== 'supported') throw new Error('expected task transport')

    await expect(
      transport.task.query('task-1', {
        signal: new AbortController().signal,
        modelDescriptor: undefined,
        headers: undefined,
        providerParams: {}
      })
    ).resolves.toEqual({ kind: 'failed', message: 'Insufficient credits' })
  })

  it('rejects a missing or unknown task status instead of assuming pending', async () => {
    for (const task of [{}, { status: 'TASK_STATUS_NEW' }]) {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ task }), { status: 200 }))
      const transport = createPpioTransport({ apiKey: 'token', fetch })
      if (transport.task.kind !== 'supported') throw new Error('expected task transport')

      await expect(
        transport.task.query('task-1', {
          signal: new AbortController().signal,
          modelDescriptor: undefined,
          headers: undefined,
          providerParams: {}
        })
      ).rejects.toThrow('Invalid JSON response')
    }
  })

  it.each([
    { status: 503, retryable: true },
    { status: 400, retryable: false }
  ])('classifies HTTP $status through APICallError retryability', async ({ status, retryable }) => {
    const fetch = vi.fn().mockResolvedValue(new Response('vendor error', { status }))
    const transport = createPpioTransport({ apiKey: 'token', fetch })
    if (transport.task.kind !== 'supported') throw new Error('expected task transport')

    const error = await transport.task
      .query('task-1', {
        signal: new AbortController().signal,
        modelDescriptor: undefined,
        headers: undefined,
        providerParams: {}
      })
      .catch((cause) => cause)

    expect(APICallError.isInstance(error)).toBe(true)
    expect((error as APICallError).isRetryable).toBe(retryable)
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
      size: '1328x1328',
      seed: undefined,
      files: undefined,
      mask: undefined,
      modelDescriptor: { id: 'jimeng-txt2img-v3.1', endpoint: '/v3/async/jimeng-txt2img-v3.1' },
      providerParams: {
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
      modelDescriptor: { id: 'seedream-4.5-draw', endpoint: '/v3/seedream-4.5', isSync: true },
      providerParams: {}
    })

    expect(result).toEqual({ kind: 'completed', imageUrls: ['https://img/a.png'] })
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
        modelDescriptor: { id: 'seedream-4.5-draw', endpoint: '/v3/seedream-4.5', isSync: true },
        providerParams: {}
      })
      .catch((error) => error)

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT)

    const error = await promise
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(`Image transport request timed out after ${DEFAULT_TIMEOUT / 1000}s`)
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
      size: '2K',
      seed: undefined,
      files: undefined,
      mask: undefined,
      modelDescriptor: {
        id: 'seedream-5.0-lite',
        endpoint: '/v3/seedream-5.0-lite',
        isSync: true,
        mode: 'generate'
      },
      providerParams: {
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
    expect(result).toEqual({ kind: 'completed', imageUrls: ['https://img/a.png', 'https://img/b.png'] })
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
      size: '2048x2048',
      seed: undefined,
      // Attached edit image flows through the canonical `input.files` path
      // (inputImages → options.files), not a providerOptions bag key.
      files: [{ mediaType: 'image/png', data: 'abc' }] as ImageGenerationSubmitInput<PpioBag>['files'],
      mask: undefined,
      modelDescriptor: {
        id: 'seedream-4.0',
        endpoint: '/v3/seedream-4.0',
        isSync: true,
        mode: 'edit'
      },
      providerParams: {}
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
      size: '1568x1056',
      seed: undefined,
      files: undefined,
      mask: undefined,
      modelDescriptor: { id: 'glm-image', endpoint: '/v3/async/glm-image', mode: 'generate' },
      providerParams: {
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
    expect(result).toEqual({ kind: 'submitted', taskId: 't-glm' })
  })
})
