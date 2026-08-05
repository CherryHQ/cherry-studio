import type { VendorBag } from '@main/ai/utils/imageOptions'
import { describe, expect, it, vi } from 'vitest'

import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { buildTokenhubTransport } from '../../tokenhub/tokenhubTransport'
import { captureImageRequest, submitWithResponse } from './captureRequest'

/**
 * TokenHub (Tencent MaaS Hunyuan) request boundary. Pins the wire per
 * https://cloud.tencent.com/document/product/1823/130080: submit posts the
 * Hunyuan job fields in snake_case (`logo_add`, `negative_prompt`,
 * `resolution`), the lite model is a synchronous OpenAI-style endpoint, and
 * polling posts `{ model, id }` to `/v1/api/image/query`.
 * Retrieved 2026-07-27.
 */

const settings = { apiKey: 'k', baseURL: 'https://tokenhub.tencentmaas.com/v1' }

function submitInput(
  overrides: Partial<ImageGenerationSubmitInput<VendorBag>> = {}
): ImageGenerationSubmitInput<VendorBag> {
  return {
    modelId: 'hy-image-v3.0',
    prompt: 'a fox',
    n: 1,
    size: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    modelDescriptor: { id: 'hy-image-v3.0', endpoint: '/v1/api/image/submit', isSync: false, mode: 'generate' },
    providerParams: {},
    ...overrides
  }
}

describe('tokenhub transport — outbound submit body', () => {
  it('posts the Hunyuan snake_case fields to the registry endpoint on the host origin', async () => {
    const transport = buildTokenhubTransport(settings)
    const captured = await captureImageRequest(
      transport,
      submitInput({
        seed: 42,
        aspectRatio: '16:9',
        providerParams: { negativePrompt: 'blurry', addWatermark: false }
      })
    )
    expect(captured.url).toBe('https://tokenhub.tencentmaas.com/v1/api/image/submit')
    expect(captured.method).toBe('POST')
    expect(captured.body).toEqual({
      model: 'hy-image-v3.0',
      prompt: 'a fox',
      seed: 42,
      negative_prompt: 'blurry',
      logo_add: false,
      resolution: '1280:720'
    })
  })

  it('omits unset optional fields entirely', async () => {
    const transport = buildTokenhubTransport(settings)
    const captured = await captureImageRequest(transport, submitInput())
    expect(captured.body).toEqual({ model: 'hy-image-v3.0', prompt: 'a fox' })
  })

  it('posts the lite model synchronously with rsp_img_type url and returns the finished images', async () => {
    const transport = buildTokenhubTransport(settings)
    const liteInput = submitInput({
      modelId: 'hy-image-lite',
      modelDescriptor: { id: 'hy-image-lite', endpoint: '/v1/api/image/lite', isSync: true, mode: 'generate' }
    })
    const captured = await captureImageRequest(transport, liteInput)
    expect(captured.url).toBe('https://tokenhub.tencentmaas.com/v1/api/image/lite')
    expect(captured.body).toEqual({ model: 'hy-image-lite', prompt: 'a fox', rsp_img_type: 'url' })

    const result = await submitWithResponse(transport, liteInput, {
      data: [{ url: 'https://img.example/1.png' }]
    })
    expect(result).toEqual({ kind: 'completed', imageUrls: ['https://img.example/1.png'] })
  })

  it('returns the job id as taskId and fails loudly when the response has none', async () => {
    const transport = buildTokenhubTransport(settings)
    await expect(submitWithResponse(transport, submitInput(), { id: 'job-1', status: 'queued' })).resolves.toEqual({
      kind: 'submitted',
      taskId: 'job-1'
    })
    await expect(submitWithResponse(transport, submitInput(), { status: 'queued' })).rejects.toThrow(
      /Invalid JSON response/
    )
  })
})

describe('tokenhub transport — poll', () => {
  function pollWithResponses(responses: unknown[]) {
    const transport = buildTokenhubTransport(settings)
    const spy = vi.spyOn(globalThis, 'fetch')
    for (const body of responses) {
      spy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }))
    }
    return { transport, spy, done: () => spy.mockRestore() }
  }

  it('queries { model, id } and returns the urls on completion (model id from the descriptor)', async () => {
    const { transport, spy, done } = pollWithResponses([
      { status: 'completed', data: [{ url: 'https://img.example/a.png' }] }
    ])
    try {
      if (transport.task.kind !== 'supported') throw new Error('expected task transport')
      const state = await transport.task.query('job-1', {
        signal: new AbortController().signal,
        modelDescriptor: { id: 'hy-image-v3.0', endpoint: '/v1/api/image/query' },
        headers: undefined,
        providerParams: {}
      })
      expect(state).toEqual({ kind: 'completed', imageUrls: ['https://img.example/a.png'] })
      const [url, init] = spy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://tokenhub.tencentmaas.com/v1/api/image/query')
      expect(JSON.parse(init.body as string)).toEqual({ model: 'hy-image-v3.0', id: 'job-1' })
    } finally {
      done()
    }
  })

  it('normalizes a failed status', async () => {
    const { transport, done } = pollWithResponses([{ status: 'failed' }])
    try {
      if (transport.task.kind !== 'supported') throw new Error('expected task transport')
      await expect(
        transport.task.query('job-1', {
          signal: new AbortController().signal,
          modelDescriptor: { id: 'hy-image-v3.0', endpoint: '/v1/api/image/query' },
          headers: undefined,
          providerParams: {}
        })
      ).resolves.toEqual({ kind: 'failed', message: 'TokenHub image task failed' })
    } finally {
      done()
    }
  })

  it('rejects a missing or unknown status instead of assuming pending', async () => {
    for (const response of [{}, { status: 'waiting' }]) {
      const { transport, done } = pollWithResponses([response])
      try {
        if (transport.task.kind !== 'supported') throw new Error('expected task transport')
        await expect(
          transport.task.query('job-1', {
            signal: new AbortController().signal,
            modelDescriptor: { id: 'hy-image-v3.0', endpoint: '/v1/api/image/query' },
            headers: undefined,
            providerParams: {}
          })
        ).rejects.toThrow('Invalid JSON response')
      } finally {
        done()
      }
    }
  })

  it('requires the persisted model descriptor', async () => {
    const transport = buildTokenhubTransport(settings)
    if (transport.task.kind !== 'supported') throw new Error('expected task transport')
    await expect(
      transport.task.query('job-1', {
        signal: new AbortController().signal,
        modelDescriptor: undefined,
        headers: undefined,
        providerParams: {}
      })
    ).rejects.toThrow(/requires a persisted modelDescriptor/)
  })

  it('does not retain submit-time task→model state', async () => {
    const { transport, done } = pollWithResponses([{ id: 'job-1' }])
    try {
      await transport.submit({
        modelId: 'hy-image-v3.0',
        prompt: 'a cat',
        n: 1,
        size: undefined,
        seed: undefined,
        files: undefined,
        mask: undefined,
        providerParams: {},
        modelDescriptor: { id: 'hy-image-v3.0', endpoint: '/v1/api/image/submit' }
      } satisfies ImageGenerationSubmitInput<VendorBag>)

      if (transport.task.kind !== 'supported') throw new Error('expected task transport')
      await expect(
        transport.task.query('job-1', {
          signal: new AbortController().signal,
          modelDescriptor: undefined,
          headers: undefined,
          providerParams: {}
        })
      ).rejects.toThrow(/requires a persisted modelDescriptor/)
    } finally {
      done()
    }
  })
})
