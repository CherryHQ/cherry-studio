import { describe, expect, it } from 'vitest'
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

  it('text2image: steps/guidance/negative_prompt/seed', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'MusePublic/489_ckpt_FLUX_1',
      prompt: 'a fox',
      size: '1024x1024',
      providerParams: { numInferenceSteps: 30, guidanceScale: 4, negativePrompt: 'blur', seed: 7 }
    } as ImageGenerationSubmitInput)

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
    } as ImageGenerationSubmitInput)

    expect(req.url).toBe(url)
    editBody.parse(req.body)
    expect(req.body).toMatchSnapshot()
  })
})
