import { APICallError } from '@ai-sdk/provider'
import { DEFAULT_TIMEOUT } from '@main/ai/constants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registryImageDescriptor } from '../../__tests__/imageCatalogFixtures'
import { createPpioTransport } from '../ppio/ppioTransport'

/**
 * Ported from the legacy `providers/ppio/__tests__/PpioService.test.ts` plus
 * coverage for the relocated transient-retry cap and param builders.
 */
describe('PpioTransport', () => {
  it.each([
    ['jimeng-txt2img-v3.1', 'generate'],
    ['hunyuan-image-3', 'generate'],
    ['qwen-image-txt2img', 'generate'],
    ['qwen-image-edit', 'edit'],
    ['glm-image', 'generate'],
    ['z-image-turbo', 'generate'],
    ['z-image-turbo-lora', 'generate'],
    ['seedream-4-0', 'generate'],
    ['seedream-4-5', 'generate']
  ] as const)('does not turn omitted %s parameters into user choices', async (modelId, mode) => {
    const requests: Request[] = []
    const transport = createPpioTransport({
      apiKey: 'token',
      modelDescriptor: registryImageDescriptor('ppio', modelId, mode),
      fetch: async (url, init) => {
        requests.push(new Request(url, init))
        return Response.json({ task_id: 'accepted', images: ['https://images.example/result.png'] })
      }
    })
    await transport.submit({
      modelId,
      prompt: 'a fox',
      n: 1,
      size: undefined,
      seed: undefined,
      files: mode === 'edit' ? [{ type: 'url', url: 'https://images.example/reference.png' }] : undefined,
      mask: undefined,
      providerParams: {}
    })
    const body = await requests[0].json()
    for (const key of [
      'seed',
      'size',
      'width',
      'height',
      'watermark',
      'watermark_enabled',
      'output_format',
      'logo_info',
      'use_pre_llm'
    ]) {
      expect(body).not.toHaveProperty(key)
    }
  })

  it('preserves an explicit disabled Jimeng watermark and seed zero', async () => {
    const requests: Request[] = []
    const transport = createPpioTransport({
      apiKey: 'token',
      modelDescriptor: registryImageDescriptor('ppio', 'jimeng-txt2img-v3.1'),
      fetch: async (url, init) => {
        requests.push(new Request(url, init))
        return Response.json({ task_id: 'accepted' })
      }
    })
    // https://ppio.com/docs/models/reference-jimeng-txt2img-v3.1 — retrieved 2026-09-09.
    await transport.submit({
      modelId: 'jimeng-txt2img-v3.1',
      prompt: 'a fox',
      n: 1,
      size: undefined,
      seed: 0,
      files: undefined,
      mask: undefined,
      providerParams: { addWatermark: false }
    })
    expect(await requests[0].json()).toEqual({ prompt: 'a fox', seed: 0, logo_info: { add_logo: false } })
  })

  // Contract: https://ppio.com/docs/models/reference-seedream-4.0 (retrieved 2026-09-09).
  it('binds the registry endpoint and preserves all generate references independently of the catalog ID', async () => {
    const descriptor = registryImageDescriptor('ppio', 'seedream-4-0')
    const requests: Request[] = []
    const transport = createPpioTransport({
      apiKey: 'token',
      modelDescriptor: descriptor,
      fetch: async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json({ images: ['https://images.example/result.png'] })
      }
    })
    await transport.submit({
      modelId: descriptor.id,
      prompt: 'combine both references',
      n: 1,
      size: undefined,
      seed: undefined,
      files: [
        { type: 'url', url: 'https://images.example/first.png' },
        { type: 'url', url: 'https://images.example/second.png' }
      ],
      mask: undefined,
      providerParams: { addWatermark: false },
      modelDescriptor: registryImageDescriptor('ppio', 'qwen-image-txt2img')
    })
    expect(requests[0].url).toBe('https://api.ppio.com/v3/seedream-4.0')
    expect(await requests[0].json()).toMatchObject({
      images: ['https://images.example/first.png', 'https://images.example/second.png'],
      watermark: false
    })
  })

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
    const transport = createPpioTransport({
      apiKey: 'token',
      fetch,
      modelDescriptor: registryImageDescriptor('ppio', 'qwen-image-txt2img')
    })
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
    const transport = createPpioTransport({
      apiKey: 'token',
      fetch,
      modelDescriptor: registryImageDescriptor('ppio', 'qwen-image-txt2img')
    })
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
      const transport = createPpioTransport({
        apiKey: 'token',
        fetch,
        modelDescriptor: registryImageDescriptor('ppio', 'qwen-image-txt2img')
      })
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
    const transport = createPpioTransport({
      apiKey: 'token',
      fetch,
      modelDescriptor: registryImageDescriptor('ppio', 'qwen-image-txt2img')
    })
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

  it('builds jimeng params without overriding an omitted prompt-enhancement setting', async () => {
    const transport = createPpioTransport({
      apiKey: 'token',
      modelDescriptor: registryImageDescriptor('ppio', 'jimeng-txt2img-v3.1', 'generate')
    })
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

    // Contract source: https://ppio.com/docs/models/reference-jimeng-txt2img-v3.1
    // Retrieved 2026-09-07. The server owns the documented default when the optional field is omitted.
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({
      prompt: 'a fox',
      width: 1328,
      height: 1328,
      logo_info: { add_logo: true }
    })
    expect(body).not.toHaveProperty('use_pre_llm')
  })

  it('uses the sync path (imageUrls) for isSync models', async () => {
    const transport = createPpioTransport({
      apiKey: 'token',
      modelDescriptor: registryImageDescriptor('ppio', 'seedream-4-5', 'generate')
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ images: ['https://img/a.png'] }), { status: 200 })
    )

    const result = await transport.submit({
      modelId: 'seedream-4.5',
      prompt: 'a fox',
      n: 1,
      size: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      modelDescriptor: { id: 'seedream-4.5', endpoint: '/v3/seedream-4.5', isSync: true },
      providerParams: {}
    })

    expect(result).toEqual({ kind: 'completed', imageUrls: ['https://img/a.png'] })
  })

  it('uses the default request timeout for isSync models', async () => {
    const transport = createPpioTransport({
      apiKey: 'token',
      modelDescriptor: registryImageDescriptor('ppio', 'seedream-4-5', 'generate')
    })
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
        modelId: 'seedream-4.5',
        prompt: 'a fox',
        n: 1,
        size: undefined,
        seed: undefined,
        files: undefined,
        mask: undefined,
        modelDescriptor: { id: 'seedream-4.5', endpoint: '/v3/seedream-4.5', isSync: true },
        providerParams: {}
      })
      .catch((error) => error)

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT)

    const error = await promise
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(`Image transport request timed out after ${DEFAULT_TIMEOUT / 1000}s`)
  })

  // Sync images: https://ppio.com/docs/models/reference-seedream-4.0 (retrieved 2026-09-09).
  it.each([{}, { url: '' }, { image_url: '' }, { image_url: 42 }, { url: 42 }])(
    'rejects a malformed sync image even beside a valid one: %j',
    async (image) => {
      const descriptor = registryImageDescriptor('ppio', 'seedream-4-0')
      const transport = createPpioTransport({
        apiKey: 'token',
        modelDescriptor: descriptor,
        fetch: async () => Response.json({ images: ['https://images.example/valid.png', image] })
      })
      await expect(
        transport.submit({
          modelId: descriptor.id,
          prompt: 'a fox',
          n: 1,
          size: undefined,
          seed: undefined,
          files: undefined,
          mask: undefined,
          providerParams: {}
        })
      ).rejects.toThrow()
    }
  )

  it('uses Seedream 4.0 plural images field for edit requests', async () => {
    const transport = createPpioTransport({
      apiKey: 'token',
      modelDescriptor: registryImageDescriptor('ppio', 'seedream-4-0', 'edit')
    })
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
      files: [{ type: 'file', mediaType: 'image/png', data: 'abc' }],
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
    const transport = createPpioTransport({
      apiKey: 'token',
      modelDescriptor: registryImageDescriptor('ppio', 'glm-image', 'generate')
    })
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
