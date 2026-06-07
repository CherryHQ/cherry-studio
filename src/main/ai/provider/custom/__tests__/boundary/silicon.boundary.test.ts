import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { SiliconImageModel } from '../../silicon/SiliconImageModel'
import { captureWithFetch } from './captureRequest'

/**
 * SiliconFlow image-model boundary — a direct OpenAI-flavored
 * `/v1/images/generations` POST. Native size→`image_size`, n>1→`batch_size`,
 * snake_case extras from the `silicon` bag, and up to three input images as
 * `image`/`image2`/`image3` data URLs.
 */
function opts(partial: Partial<ImageModelV3CallOptions>): ImageModelV3CallOptions {
  return {
    prompt: 'a fox',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    providerOptions: {},
    headers: undefined,
    abortSignal: undefined,
    files: undefined,
    mask: undefined,
    ...partial
  } as ImageModelV3CallOptions
}

const config = {
  provider: 'silicon.image',
  url: ({ path }: { path: string }) => `https://api.siliconflow.cn/v1${path}`,
  headers: () => ({ Authorization: 'Bearer sk' })
}

const url = 'https://api.siliconflow.cn/v1/images/generations'

describe('SiliconFlow image-model boundary', () => {
  it('text2image: image_size + seed + snake_case extras', async () => {
    const req = await captureWithFetch((fetch) =>
      new SiliconImageModel('Qwen/Qwen-Image', { ...config, fetch }).doGenerate(
        opts({
          size: '1024x1024',
          seed: 7,
          providerOptions: { silicon: { negative_prompt: 'blur', num_inference_steps: 20, guidance_scale: 7.5 } }
        })
      )
    )
    expect(req.url).toBe(url)
    z.strictObject({
      model: z.string(),
      prompt: z.string(),
      image_size: z.string(),
      seed: z.number().int(),
      negative_prompt: z.string(),
      num_inference_steps: z.number(),
      guidance_scale: z.number()
    }).parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('edit: input files inlined as image/image2 data URLs', async () => {
    const req = await captureWithFetch((fetch) =>
      new SiliconImageModel('Qwen/Qwen-Image-Edit-2509', { ...config, fetch }).doGenerate(
        opts({
          files: [
            { mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
            { mediaType: 'image/jpeg', data: new Uint8Array([4, 5, 6]) }
          ] as ImageModelV3CallOptions['files']
        })
      )
    )
    expect(req.url).toBe(url)
    z.strictObject({
      model: z.string(),
      prompt: z.string(),
      image: z.string(),
      image2: z.string()
    }).parse(req.body)
    expect(req.body).toMatchSnapshot()
  })
})
