import type { VendorBag } from '@main/ai/utils/imageOptions'
import { describe, expect, it, vi } from 'vitest'

import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { buildTokenhubTransport, TokenhubTaskFailedError } from '../../tokenhub/tokenhubTransport'
import { captureImageRequest, submitWithResponse } from './captureRequest'

/**
 * TokenHub (Tencent MaaS Hunyuan) request boundary. Pins the wire per
 * https://cloud.tencent.com/document/product/1823/130080: submit posts the
 * Hunyuan job fields in snake_case (`logo_add`, `negative_prompt`,
 * `resolution`), the lite model is a synchronous OpenAI-style endpoint, and
 * polling posts `{ model, id }` to `/v1/api/image/query`.
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
      data: [{ url: 'https://img.example/1.png' }, { revised_prompt: 'no url' }]
    })
    expect(result).toEqual({ imageUrls: ['https://img.example/1.png'] })
  })

  it('returns the job id as taskId and fails loudly when the response has none', async () => {
    const transport = buildTokenhubTransport(settings)
    await expect(submitWithResponse(transport, submitInput(), { id: 'job-1', status: 'queued' })).resolves.toEqual({
      taskId: 'job-1'
    })
    await expect(submitWithResponse(transport, submitInput(), { status: 'queued' })).rejects.toThrow(
      /returned no task id/
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
      const urls = await transport.poll!('job-1', { modelDescriptor: { id: 'hy-image-v3.0' } as never })
      expect(urls).toEqual(['https://img.example/a.png'])
      const [url, init] = spy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://tokenhub.tencentmaas.com/v1/api/image/query')
      expect(JSON.parse(init.body as string)).toEqual({ model: 'hy-image-v3.0', id: 'job-1' })
    } finally {
      done()
    }
  })

  it('throws TokenhubTaskFailedError on a failed status', async () => {
    const { transport, done } = pollWithResponses([{ status: 'failed' }])
    try {
      await expect(transport.poll!('job-1', { modelDescriptor: { id: 'hy-image-v3.0' } as never })).rejects.toThrow(
        TokenhubTaskFailedError
      )
    } finally {
      done()
    }
  })

  it('requires a model id (from submit on this instance or the descriptor)', async () => {
    const transport = buildTokenhubTransport(settings)
    await expect(transport.poll!('job-1', {})).rejects.toThrow(/requires the model id/)
  })

  it('releases the task→model id entry when the task FAILS, not only when it completes', async () => {
    // The entry was deleted on the success branch only, and TokenHub has no `cancel()`
    // to clean up after a failure/abort/timeout — so every failed task pinned its model
    // id for the lifetime of the transport. Observable through the model-id requirement:
    // once released, a later poll of the same id has no remembered model.
    // One spy, both responses queued: submit hands back the task id (which records the
    // model), then the poll reports failure.
    const { transport, done } = pollWithResponses([{ id: 'job-1' }, { status: 'failed' }])
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

      await expect(transport.poll!('job-1', {})).rejects.toThrow(TokenhubTaskFailedError)
      // Entry released by the failure, so the remembered model id is gone.
      await expect(transport.poll!('job-1', {})).rejects.toThrow(/requires the model id/)
    } finally {
      done()
    }
  })
})
