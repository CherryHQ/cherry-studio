import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { createDashScope } from '../dashscope-provider'

describe('DashScope image provider', () => {
  it('uses the native Qwen Image 3 endpoint and request contract', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init
      if (String(input) === 'https://cdn.example.com/result.png') {
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
      }
      return new Response(
        JSON.stringify({
          output: { choices: [{ message: { content: [{ image: 'https://cdn.example.com/result.png' }] } }] },
          request_id: 'request-1'
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    })
    const model = createDashScope({
      apiKey: 'dashscope-key',
      baseURL: 'https://proxy.example.com/compatible-mode/v1',
      fetch
    }).imageModel('qwen-image-3.0')

    const result = await model.doGenerate({
      prompt: 'draw a cat',
      n: 2,
      size: '1024x1024',
      aspectRatio: undefined,
      seed: 7,
      files: [{ type: 'file', mediaType: 'image/png', data: 'aGVsbG8=' }],
      mask: undefined,
      providerOptions: { dashscope: { negativePrompt: 'blur', promptExtend: false } }
    } satisfies ImageModelV3CallOptions)

    expect(fetch).toHaveBeenCalledTimes(2)
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toBe('https://proxy.example.com/api/v1/services/aigc/multimodal-generation/generation')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer dashscope-key')
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'qwen-image-3.0',
      input: {
        messages: [
          {
            role: 'user',
            content: [{ text: 'draw a cat' }, { image: 'data:image/png;base64,aGVsbG8=' }]
          }
        ]
      },
      parameters: {
        size: '1024*1024',
        n: 2,
        seed: 7,
        negative_prompt: 'blur',
        prompt_extend: false
      }
    })
    expect(result.images).toEqual([new Uint8Array([1, 2, 3])])
  })
})
