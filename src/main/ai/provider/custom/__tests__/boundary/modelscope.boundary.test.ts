import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import type { ModelscopeProviderParams } from '../../modelscope/modelscopeTransport'
import { createModelscopeTransport } from '../../modelscope/modelscopeTransport'
import { captureImageRequest } from './captureRequest'

/**
 * ModelScope request boundary — async submit to `/v1/images/generations`. Uses
 * `steps`/`guidance` (not the canonical names), the WxH `size` string verbatim,
 * and `image_url` (data URL) for edit models.
 */
const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
} satisfies Partial<ImageGenerationSubmitInput<ModelscopeProviderParams>>

const url = 'https://api-inference.modelscope.cn/v1/images/generations'

const txt2imgBody = z.strictObject({
  model: z.string(),
  prompt: z.string(),
  size: z.string(),
  steps: z.number().int().positive(),
  guidance: z.number(),
  negative_prompt: z.string(),
  seed: z.number().int()
})

const editBody = z.strictObject({
  model: z.string(),
  prompt: z.string(),
  image_url: z.string()
})

describe('ModelScope request boundary', () => {
  const transport = createModelscopeTransport({ apiKey: 'ms-key', baseURL: 'https://api-inference.modelscope.cn' })

  it('text2image: steps/guidance/negative_prompt/seed', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'MusePublic/489_ckpt_FLUX_1',
      prompt: 'a fox',
      size: '1024x1024',
      seed: 7,
      providerParams: { numInferenceSteps: 30, guidanceScale: 4, negativePrompt: 'blur' }
    } as ImageGenerationSubmitInput<ModelscopeProviderParams>)

    expect(req.url).toBe(url)
    txt2imgBody.parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('edit: inlines the input file as image_url data URL', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'Qwen/Qwen-Image-Edit',
      prompt: 'make it night',
      files: [
        { mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }
      ] as ImageGenerationSubmitInput<ModelscopeProviderParams>['files']
    } as ImageGenerationSubmitInput<ModelscopeProviderParams>)

    expect(req.url).toBe(url)
    editBody.parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('uses the injected fetch and gives the required async header final precedence', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ task_id: 'task-1' }), { status: 200 }))
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('global fetch used'))
    const injectedTransport = createModelscopeTransport({
      apiKey: 'ms-key',
      baseURL: 'https://api-inference.modelscope.cn',
      headers: {
        Authorization: 'Bearer provider',
        'X-ModelScope-Async-Mode': 'false',
        'x-provider': 'one'
      },
      fetch
    })

    // Contract source: https://modelscope.cn/docs/model-service/API-Inference/intro
    // Retrieved 2026-07-27.
    await injectedTransport.submit({
      ...base,
      modelId: 'MusePublic/489_ckpt_FLUX_1',
      prompt: 'a fox',
      providerParams: {},
      headers: {
        Authorization: 'Bearer request',
        'X-ModelScope-Async-Mode': 'false',
        'x-request': 'two'
      }
    } as ImageGenerationSubmitInput<ModelscopeProviderParams>)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(globalFetch).not.toHaveBeenCalled()
    const requestHeaders = Object.fromEntries(new Headers(fetch.mock.calls[0][1]?.headers).entries())
    expect(requestHeaders).toMatchObject({
      authorization: 'Bearer request',
      'x-modelscope-async-mode': 'true',
      'x-provider': 'one',
      'x-request': 'two'
    })
    globalFetch.mockRestore()
  })

  it('rejects a missing or unknown query status instead of assuming pending', async () => {
    for (const response of [{}, { task_status: 'UNKNOWN' }]) {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }))
      const strictTransport = createModelscopeTransport({ apiKey: 'ms-key', fetch })
      if (strictTransport.task.kind !== 'supported') throw new Error('expected task transport')

      await expect(
        strictTransport.task.query('task-1', {
          signal: new AbortController().signal,
          modelDescriptor: undefined,
          headers: undefined,
          providerParams: {}
        })
      ).rejects.toThrow('Invalid JSON response')
    }
  })
})
