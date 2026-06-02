import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { SiliconImageModel } from '../../silicon/SiliconImageModel'
import { runWithResponse } from './captureRequest'

/** Inbound (response) boundary for SiliconFlow — `images|data[].url|b64_json`. */
function opts(): ImageModelV3CallOptions {
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
    mask: undefined
  } as ImageModelV3CallOptions
}

const config = {
  provider: 'silicon.image',
  url: ({ path }: { path: string }) => `https://api.siliconflow.cn/v1${path}`,
  headers: () => ({ Authorization: 'Bearer sk' })
}

const responseSchema = z.object({
  images: z.array(z.object({ url: z.string().optional(), b64_json: z.string().optional() })).optional(),
  data: z.array(z.object({ url: z.string().optional(), b64_json: z.string().optional() })).optional()
})

describe('SiliconFlow response boundary', () => {
  it('images[].url → images', async () => {
    const response = { images: [{ url: 'https://img/s.png' }] }
    responseSchema.parse(response)
    const result = await runWithResponse(response, (fetch) =>
      new SiliconImageModel('Qwen/Qwen-Image', { ...config, fetch }).doGenerate(opts())
    )
    expect(result.images).toMatchSnapshot()
  })

  it('data[].url → images', async () => {
    const response = { data: [{ url: 'https://img/d.png' }] }
    responseSchema.parse(response)
    const result = await runWithResponse(response, (fetch) =>
      new SiliconImageModel('Qwen/Qwen-Image', { ...config, fetch }).doGenerate(opts())
    )
    expect(result.images).toMatchSnapshot()
  })
})
