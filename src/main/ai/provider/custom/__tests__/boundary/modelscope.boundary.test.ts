import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
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
} satisfies Partial<ImageGenerationSubmitInput>

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

  it.each([
    {
      name: 'future and nullish states',
      responses: [
        { task_status: 'WAITING_FOR_WORKER' },
        {},
        { task_status: null },
        { task_status: 'SUCCEED', output_images: ['https://cdn.example.com/result.png'] }
      ]
    },
    {
      name: 'a malformed successful response followed by a valid retry',
      responses: [
        { task_status: 'SUCCEED', output_images: 'not-an-image-array' },
        { task_status: 'SUCCEED', output_images: ['https://cdn.example.com/result.png'] }
      ]
    }
  ])('polls through $name without consuming invalid image results', async ({ responses }) => {
    vi.useFakeTimers()
    try {
      const pending = [...responses]
      const polling = createModelscopeTransport({
        apiKey: 'ms-key',
        fetch: async () => new Response(JSON.stringify(pending.shift()))
      })
      const result = polling.poll('task/1', {})
      await vi.runAllTimersAsync()
      await expect(result).resolves.toEqual(['https://cdn.example.com/result.png'])
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([{ task_id: 42 }, { task_id: '' }, {}])('rejects unusable submit task identities: %j', async (body) => {
    const submitting = createModelscopeTransport({
      apiKey: 'ms-key',
      fetch: async () => new Response(JSON.stringify(body))
    })
    await expect(submitting.submit({ ...base, modelId: 'Qwen/Qwen-Image', prompt: 'a fox' })).rejects.toThrow()
  })

  it('text2image: steps/guidance/negative_prompt/seed', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'MusePublic/489_ckpt_FLUX_1',
      prompt: 'a fox',
      size: '1024x1024',
      seed: 7,
      providerParams: { numInferenceSteps: 30, guidanceScale: 4, negativePrompt: 'blur' }
    })

    expect(req.url).toBe(url)
    txt2imgBody.parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('edit: inlines the input file as image_url data URL', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'Qwen/Qwen-Image-Edit',
      prompt: 'make it night',
      files: [{ mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }] as ImageGenerationSubmitInput['files']
    })

    expect(req.url).toBe(url)
    editBody.parse(req.body)
    expect(req.body).toMatchSnapshot()
  })
})
