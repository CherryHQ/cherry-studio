import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createSiliconProvider } from '../../silicon/siliconProvider'

const options = {
  prompt: 'a fox',
  n: 1,
  size: undefined,
  aspectRatio: undefined,
  seed: undefined,
  providerOptions: {},
  files: undefined,
  mask: undefined
} satisfies ImageModelV3CallOptions

// https://api-docs.siliconflow.cn/docs/api/images-generations-post — retrieved 2026-09-09.
describe('SiliconFlow image boundary', () => {
  it('delivers Kolors canonical sampling parameters without camelCase wire duplicates', async () => {
    const requests: Request[] = []
    const provider = createSiliconProvider({
      apiKey: 'key',
      fetch: async (url, init) => {
        requests.push(new Request(url, init))
        return Response.json({ images: [{ url: 'https://image.example/out.png' }] })
      }
    })
    const result = await provider.imageModel('Kwai-Kolors/Kolors').doGenerate({
      ...options,
      size: '1024x1024',
      seed: 0,
      providerOptions: { silicon: { negativePrompt: 'blur', numInferenceSteps: 20, guidanceScale: 7.5 } }
    })
    expect(requests[0].url).toBe('https://api.siliconflow.cn/v1/images/generations')
    expect(await requests[0].json()).toEqual({
      model: 'Kwai-Kolors/Kolors',
      prompt: 'a fox',
      image_size: '1024x1024',
      seed: 0,
      negative_prompt: 'blur',
      num_inference_steps: 20,
      guidance_scale: 7.5
    })
    expect(result.images).toEqual(['https://image.example/out.png'])
  })

  it('preserves each Qwen edit input representation and returns a mask warning', async () => {
    const requests: Request[] = []
    const provider = createSiliconProvider({
      apiKey: 'key',
      fetch: async (url, init) => {
        requests.push(new Request(url, init))
        return Response.json({ images: [{ url: 'https://image.example/out.png' }] })
      }
    })
    const result = await provider.imageModel('Qwen/Qwen-Image-Edit-2509').doGenerate({
      ...options,
      files: [
        { type: 'file', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
        { type: 'file', mediaType: 'image/png', data: 'data:image/png;base64,BAUG' },
        { type: 'url', url: 'https://image.example/reference.png' }
      ],
      mask: { type: 'file', mediaType: 'image/png', data: new Uint8Array([0]) }
    })
    expect(await requests[0].json()).toEqual({
      model: 'Qwen/Qwen-Image-Edit-2509',
      prompt: 'a fox',
      image: 'data:image/png;base64,AQID',
      image2: 'data:image/png;base64,BAUG',
      image3: 'https://image.example/reference.png'
    })
    expect(result.warnings).toContainEqual({ type: 'unsupported', feature: 'mask' })
  })
})
