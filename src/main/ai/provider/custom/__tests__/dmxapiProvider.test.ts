import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createDmxapiProvider } from '../dmxapi/dmxapiProvider'

const options = {
  prompt: 'a fox',
  n: 1,
  size: undefined,
  seed: 0,
  aspectRatio: undefined,
  files: undefined,
  mask: undefined,
  providerOptions: { dmxapi: { addWatermark: false, sequentialImageGeneration: 'auto', maxImages: 2 } }
} satisfies ImageModelV3CallOptions

describe('DMXAPI thin image adapter', () => {
  // https://doc.dmxapi.cn/doubao-seedream-5.0-lite-t2i.html — retrieved 2026-09-09.
  it.each(['https://gateway.example/v1', 'https://gateway.example'])(
    'uses injected HTTP and canonical params with base %s',
    async (baseURL) => {
      const requests: Request[] = []
      const provider = createDmxapiProvider({
        apiKey: 'key',
        baseURL,
        headers: { 'x-provider': 'cherry' },
        fetch: async (url, init) => {
          requests.push(new Request(url, init))
          return Response.json({
            status: 'completed',
            output: [
              {
                type: 'message',
                status: 'completed',
                content: [{ type: 'output_text', text: '![Image 1](https://image.example/out.png)' }]
              }
            ]
          })
        }
      })
      const result = await provider
        .imageModel('doubao-seedream-5.0-lite')
        .doGenerate({ ...options, headers: { 'x-call': 'once' } })
      expect(requests[0].url).toBe('https://gateway.example/v1/responses')
      expect(await requests[0].json()).toEqual({
        model: 'doubao-seedream-5.0-lite',
        input: 'a fox',
        stream: false,
        seed: 0,
        watermark: false,
        sequential_image_generation: 'auto',
        sequential_image_generation_options: { max_images: 2 }
      })
      expect(requests[0].headers.get('x-provider')).toBe('cherry')
      expect(requests[0].headers.get('x-call')).toBe('once')
      expect(result.images).toEqual(['https://image.example/out.png'])
    }
  )

  it('refuses to reuse an explicit custom binding for another model', () => {
    const provider = createDmxapiProvider({
      apiKey: 'key',
      baseURL: 'https://gateway.example/v1',
      imageBinding: { kind: 'custom', binding: { modelId: 'qwen-image', family: 'openai-flat-async' } }
    })
    expect(() => provider.imageModel('gpt-image-1.5')).toThrow('binding does not match model')
  })
})
